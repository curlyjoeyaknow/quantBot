import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ClickHouseClient } from '@clickhouse/client';
import type {
  CandleSlicePort,
  CandleSliceSpec,
  SliceExportResult,
  RunContext,
} from '../../ports/CandleSlicePort.js';

function sha(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const CANDLES_SCHEMA_V1 = {
  kind: 'candles_parquet_v1',
  columns: ['chain', 'token_id', 'ts', 'interval', 'open', 'high', 'low', 'close', 'volume'],
};

const CANDLES_SCHEMA_HASH_V1 = sha(JSON.stringify(CANDLES_SCHEMA_V1));

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function assertIsoOrder(startIso: string, endIso: string) {
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b))
    throw new Error(`Invalid ISO times: start=${startIso} end=${endIso}`);
  if (a >= b)
    throw new Error(`Invalid time range (start must be < end): start=${startIso} end=${endIso}`);
}

function stableTokenSetHash(tokenIds: string[]): string {
  return sha(JSON.stringify([...tokenIds].sort()));
}

// JSON-serializable value type
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function writeJson(p: string, obj: JsonValue) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

async function streamToFile(stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>, outPath: string): Promise<void> {
  ensureDir(path.dirname(outPath));
  const w = fs.createWriteStream(outPath);

  try {
    if (Symbol.asyncIterator in stream) {
      // AsyncIterable
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        w.write(Buffer.from(chunk));
      }
    } else {
      // ReadableStream
      const reader = (stream as ReadableStream<Uint8Array>).getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          w.write(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
    }
    w.end();
    await new Promise<void>((resolve, reject) => {
      w.on('error', reject);
      w.on('finish', resolve);
    });
  } catch (error) {
    w.destroy();
    throw error;
  }
}

export class CandleSliceExporter implements CandleSlicePort {
  constructor(private readonly ch?: ClickHouseClient) {}

  async exportSlice(args: {
    run: RunContext;
    spec: CandleSliceSpec;
    artifactDir: string;
  }): Promise<SliceExportResult> {
    const { spec } = args;

    if (!this.ch) throw new Error('CandleSliceExporter: missing ClickHouse client (inject in wiring/composition root)');
    if (spec.tokenIds.length === 0)
      throw new Error('CandleSliceExporter: tokenIds empty (refuse to export empty slice)');
    assertIsoOrder(spec.startIso, spec.endIso);

    ensureDir(args.artifactDir);

    const outParquet = path.join(args.artifactDir, 'candles.parquet');
    const manifestPath = path.join(args.artifactDir, 'slice.manifest.json');

    // IMPORTANT:
    // Keep join key stable: (token_id, ts, interval)
    // We emit ts as DateTime and interval as fixed string (e.g. '1m').
    // ClickHouse schema uses token_address and timestamp, but we output token_id and ts for consistency.
    const tokenListSql = spec.tokenIds.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');

    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Query ClickHouse ohlcv_candles table and output as Parquet
    // Map token_address -> token_id, timestamp -> ts for output schema
    const query = `
      SELECT
        '${spec.chain}' AS chain,
        token_address AS token_id,
        timestamp AS ts,
        '${spec.interval}' AS interval,
        open,
        high,
        low,
        close,
        volume
      FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
      WHERE chain = '${spec.chain}'
        AND interval = '${spec.interval}'
        AND timestamp >= parseDateTimeBestEffort('${spec.startIso}')
        AND timestamp < parseDateTimeBestEffort('${spec.endIso}')
        AND token_address IN (${tokenListSql})
      ORDER BY token_address, timestamp
      FORMAT Parquet
    `.trim();

    const res = await this.ch.query({ query, format: 'Parquet' });
    // ClickHouse Parquet stream - cast through unknown to handle type mismatch
    await streamToFile(res.stream as unknown as AsyncIterable<Uint8Array>, outParquet);

    const tokenSetHash = stableTokenSetHash(spec.tokenIds);

    const manifest = {
      kind: 'slice_manifest_v1',
      dataset: spec.dataset,
      chain: spec.chain,
      interval: spec.interval,
      startIso: spec.startIso,
      endIso: spec.endIso,
      tokenCount: spec.tokenIds.length,
      tokenSetHash,
      files: [outParquet],
      schemaHash: CANDLES_SCHEMA_HASH_V1,
      // sliceHash must be stable for same exact slice definition + schema.
      sliceHash: sha(
        JSON.stringify({
          dataset: spec.dataset,
          chain: spec.chain,
          interval: spec.interval,
          startIso: spec.startIso,
          endIso: spec.endIso,
          tokenSetHash,
          schemaHash: CANDLES_SCHEMA_HASH_V1,
        })
      ),
      createdAtIso: args.run.createdAtIso,
    };

    writeJson(manifestPath, manifest);

    return {
      manifestPath,
      parquetPaths: [outParquet],
      sliceHash: manifest.sliceHash,
      schemaHash: manifest.schemaHash,
    };
  }
}
