import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { FeatureComputePort, FeatureSpecV1, FeatureComputeResult } from '../../ports/FeatureComputePort.js';
import type { RunContext } from '../../ports/CandleSlicePort.js';
import type { DuckDbConnection } from './duckdbClient.js';

function sha(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

type SliceManifestV1 = {
  kind: 'slice_manifest_v1';
  files: string[];
  schemaHash: string;
  sliceHash: string;
};

function normalizeFeatureSpec(spec: FeatureSpecV1): string {
  // stable stringify (good enough for now)
  return JSON.stringify(spec);
}

function parseIndicators(spec: FeatureSpecV1): Array<{ kind: string; params: Record<string, any> }> {
  const out: Array<{ kind: string; params: Record<string, any> }> = [];
  for (const g of spec.groups ?? []) {
    for (const item of g.indicators ?? []) {
      const keys = Object.keys(item);
      if (keys.length !== 1) throw new Error(`Invalid indicator object: ${JSON.stringify(item)}`);
      const kind = keys[0];
      out.push({ kind, params: item[kind] ?? {} });
    }
  }
  return out;
}

// NOTE: DuckDB doesn't have native EMA as a built-in aggregate.
// MVP approach: use an approximation or implement EMA via recursive CTE later.
// For now, we implement:
// - SMA (exact)
// - RSI (exact-ish using average gains/losses over window)
// - ATR (true range + SMA)
// EMA support is stubbed in SQL plan and can be upgraded in Phase 1.2.

function sqlForIndicators(indicators: Array<{ kind: string; params: Record<string, any> }>): { selectCols: string[] } {
  const cols: string[] = [];

  for (const ind of indicators) {
    if (ind.kind === 'sma') {
      const period = Number(ind.params.period ?? 14);
      const src = String(ind.params.source ?? 'close');
      cols.push(
        `AVG(${src}) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS sma_${period}`
      );
    } else if (ind.kind === 'ema') {
      const period = Number(ind.params.period ?? 14);
      // Placeholder column; upgrade to recursive EMA later.
      // This keeps downstream graph compilation happy while you iterate.
      cols.push(`NULL::DOUBLE AS ema_${period}`);
    } else if (ind.kind === 'rsi') {
      const period = Number(ind.params.period ?? 14);
      const src = String(ind.params.source ?? 'close');
      // MVP: Only support 'close' as source for RSI (uses d_close from enriched view)
      // TODO: Support other sources by computing additional deltas in enriched view
      if (src !== 'close') {
        throw new Error(`RSI source '${src}' not supported in MVP (only 'close' is supported)`);
      }
      // Gains/losses based on delta of close
      cols.push(`
        (
          CASE
            WHEN AVG(CASE WHEN d_close > 0 THEN d_close ELSE 0 END)
                 OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period} PRECEDING AND CURRENT ROW) = 0
            THEN 0
            ELSE 100 - (100 / (1 + (
              AVG(CASE WHEN d_close > 0 THEN d_close ELSE 0 END)
                OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period} PRECEDING AND CURRENT ROW)
              /
              NULLIF(AVG(CASE WHEN d_close < 0 THEN -d_close ELSE 0 END)
                OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period} PRECEDING AND CURRENT ROW), 0)
            )))
          END
        ) AS rsi_${period}
      `.trim());
    } else if (ind.kind === 'atr') {
      const period = Number(ind.params.period ?? 14);
      // TR = max(high-low, abs(high-prev_close), abs(low-prev_close))
      cols.push(`
        AVG(tr) OVER (PARTITION BY token_id ORDER BY ts ROWS BETWEEN ${period - 1} PRECEDING AND CURRENT ROW) AS atr_${period}
      `.trim());
    } else {
      throw new Error(`Unsupported indicator kind: ${ind.kind}`);
    }
  }

  return { selectCols: cols };
}

export class FeatureComputer implements FeatureComputePort {
  constructor(private readonly db?: DuckDbConnection) {}

  async compute(args: {
    run: RunContext;
    sliceManifestPath: string;
    sliceHash: string;
    featureSpec: FeatureSpecV1;
    artifactDir: string;
  }): Promise<FeatureComputeResult> {
    if (!this.db) throw new Error('FeatureComputer: missing DuckDB connection (inject in wiring/composition root)');

    ensureDir(args.artifactDir);

    const sliceManifest = readJson<SliceManifestV1>(args.sliceManifestPath);
    if (!sliceManifest.files?.length) throw new Error(`Slice manifest has no files: ${args.sliceManifestPath}`);

    const featureSetId = sha(normalizeFeatureSpec(args.featureSpec));
    const outParquet = path.join(args.artifactDir, 'features.parquet');
    const manifestPath = path.join(args.artifactDir, 'features.manifest.json');

    const indicators = parseIndicators(args.featureSpec);

    // Register candles as a view over parquet.
    // We assume the parquet contains: chain, token_id, ts, interval, open, high, low, close, volume
    // We create deltas and true range helpers for RSI/ATR.
    const parquetPaths = sliceManifest.files.map((f) => `'${f.replace(/'/g, "''")}'`).join(', ');

    await this.db.run(`
      CREATE OR REPLACE VIEW candles AS
      SELECT * FROM read_parquet([${parquetPaths}])
    `);

    // Helpers: delta for RSI sources, prev_close, true range.
    await this.db.run(`
      CREATE OR REPLACE VIEW candles_enriched AS
      SELECT
        chain,
        token_id,
        ts,
        interval,
        open, high, low, close, volume,
        (close - LAG(close) OVER (PARTITION BY token_id ORDER BY ts)) AS d_close,
        LAG(close) OVER (PARTITION BY token_id ORDER BY ts) AS prev_close,
        GREATEST(
          high - low,
          ABS(high - LAG(close) OVER (PARTITION BY token_id ORDER BY ts)),
          ABS(low  - LAG(close) OVER (PARTITION BY token_id ORDER BY ts))
        ) AS tr
      FROM candles
    `);

    const plan = sqlForIndicators(indicators);

    const baseCols = ['chain', 'token_id', 'ts', 'interval'];
    const selectCols = [...baseCols, ...plan.selectCols];

    const sql = `
      SELECT
        ${selectCols.join(",\n        ")}
      FROM candles_enriched
      ORDER BY token_id, ts
    `.trim();

    // Write parquet
    await this.db.run(`COPY (${sql}) TO '${outParquet}' (FORMAT PARQUET)`);

    const columns = selectCols.map((c) => {
      // normalize alias extraction for manifest
      const m = c.match(/\s+AS\s+([a-zA-Z0-9_]+)\s*$/i);
      return m ? m[1] : c.trim();
    });

    const manifest = {
      kind: 'feature_manifest_v1',
      featureSetId,
      sliceHash: args.sliceHash,
      createdAtIso: args.run.createdAtIso,
      featuresParquetPath: outParquet,
      columns,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    return {
      featureSetId,
      featuresParquetPath: outParquet,
      manifestPath,
    };
  }
}
