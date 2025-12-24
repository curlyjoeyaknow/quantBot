/**
 * ClickHouse -> Parquet exporter adapter implementation
 *
 * Simple, working implementation for 1m OHLCV candles.
 * Start with one dataset, one filter mode, one Parquet file.
 */

import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { getClickHouseClient } from '../clickhouse-client.js';
import { logger } from '@quantbot/utils';
import type { SliceExporter } from '@quantbot/workflows';
import type { ParquetLayoutSpec, RunContext, SliceManifestV1, SliceSpec } from '@quantbot/workflows';

/**
 * Simple template expander
 */
function expandTemplate(tpl: string, vars: Record<string, string>): string {
  let result = tpl;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Simple hash function (deterministic)
 */
function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/**
 * ClickHouse Slice Exporter Adapter - Working Implementation
 *
 * Currently supports:
 * - Dataset: "candles_1m" (maps to ohlcv_candles table with interval='1m')
 * - Simple filters: time range + optional tokenIds
 * - Single Parquet file output
 */
export class ClickHouseSliceExporterAdapterImpl implements SliceExporter {
  async exportSlice(args: { run: RunContext; spec: SliceSpec; layout: ParquetLayoutSpec }): Promise<SliceManifestV1> {
    const { run, spec, layout } = args;

    // Validate dataset (start simple)
    if (spec.dataset !== 'candles_1m') {
      throw new Error(`Unsupported dataset: ${spec.dataset}. Currently only 'candles_1m' is supported.`);
    }

    // Build output directory from template
    const day = spec.timeRange.startIso.slice(0, 10);
    const vars: Record<string, string> = {
      dataset: spec.dataset,
      chain: spec.chain,
      runId: run.runId,
      strategyId: run.strategyId ?? 'none',
      yyyy: day.slice(0, 4),
      mm: day.slice(5, 7),
      dd: day.slice(8, 10),
    };

    const subdir = expandTemplate(layout.subdirTemplate, vars);
    const base = layout.baseUri.replace(/^file:\/\//, '').replace(/\/+$/, '');
    const outDir = join(base, subdir).replace(/\/+/g, '/');

    // Ensure directory exists
    await fs.mkdir(outDir, { recursive: true });

    // Build ClickHouse query
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    // Map dataset to table
    const tableName = `${CLICKHOUSE_DATABASE}.ohlcv_candles`;

    // Build WHERE clause
    const conditions: string[] = [];

    // Time range
    conditions.push(`timestamp >= '${spec.timeRange.startIso}'`);
    conditions.push(`timestamp < '${spec.timeRange.endIso}'`);

    // Chain
    conditions.push(`chain = '${spec.chain}'`);

    // Interval (always 1m for now)
    conditions.push(`interval = '1m'`);

    // Token filter
    if (spec.tokenIds && spec.tokenIds.length > 0) {
      const tokenList = spec.tokenIds.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(', ');
      conditions.push(`token_address IN (${tokenList})`);
    }

    const whereClause = conditions.join(' AND ');

    // Select columns (or all if not specified)
    const columns = spec.columns && spec.columns.length > 0
      ? spec.columns.join(', ')
      : 'token_address, chain, timestamp, interval, open, high, low, close, volume';

    // Query ClickHouse and export to Parquet
    const query = `
      SELECT ${columns}
      FROM ${tableName}
      WHERE ${whereClause}
      ORDER BY token_address, timestamp
      FORMAT Parquet
    `;

    logger.info('Exporting slice from ClickHouse', {
      dataset: spec.dataset,
      chain: spec.chain,
      timeRange: spec.timeRange,
      tokenCount: spec.tokenIds?.length ?? 0,
    });

    // Execute query and get Parquet stream
    const result = await ch.query({
      query,
      format: 'Parquet',
    });

    // Read Parquet data from stream
    // ClickHouse client returns a stream that can be read as async iterable
    const stream = result.stream;
    const chunks: Buffer[] = [];

    // Try to read as async iterable (if supported)
    if (Symbol.asyncIterator in stream) {
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
    } else {
      // Fallback: read as ReadableStream (cast through unknown to avoid type errors)
      const readableStream = stream as unknown as ReadableStream<Uint8Array>;
      const reader = readableStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(Buffer.from(value));
          }
        }
      } finally {
        reader.releaseLock();
      }
    }

    const parquetData = Buffer.concat(chunks);

    // Write Parquet file
    const parquetPath = join(outDir, 'part-000.parquet');
    await fs.writeFile(parquetPath, parquetData);

    // Get row count (query separately since Parquet format doesn't include it)
    const countQuery = `
      SELECT count(*) as cnt
      FROM ${tableName}
      WHERE ${whereClause}
    `;
    const countResult = await ch.query({
      query: countQuery,
      format: 'JSONEachRow',
    });
    const countData = (await countResult.json()) as Array<{ cnt: string }>;
    const rowCount = countData.length > 0 ? parseInt(countData[0].cnt || '0', 10) : 0;

    // Get file size
    const stats = await fs.stat(parquetPath);
    const byteSize = stats.size;

    // Get observed time range
    const timeRangeQuery = `
      SELECT 
        min(timestamp) as min_ts,
        max(timestamp) as max_ts
      FROM ${tableName}
      WHERE ${whereClause}
    `;
    const timeRangeResult = await ch.query({
      query: timeRangeQuery,
      format: 'JSONEachRow',
    });
    const timeRangeData = (await timeRangeResult.json()) as Array<{ min_ts: string; max_ts: string }>;
    const timeRangeObserved = timeRangeData.length > 0
      ? {
          startIso: timeRangeData[0].min_ts,
          endIso: timeRangeData[0].max_ts,
        }
      : undefined;

    // Generate manifest
    const createdAtIso = new Date().toISOString();
    const specHash = hash(JSON.stringify({ run, spec, layout }));

    const manifest: SliceManifestV1 = {
      version: 1,
      manifestId: hash(`manifest:${specHash}:${createdAtIso}`),
      createdAtIso,
      run,
      spec,
      layout,
      parquetFiles: [
        {
          path: parquetPath,
          rowCount,
          byteSize,
          dt: day,
        },
      ],
      summary: {
        totalFiles: 1,
        totalRows: rowCount,
        totalBytes: byteSize,
        timeRangeObserved,
      },
      integrity: {
        specHash,
      },
    };

    // Write manifest
    const manifestPath = join(outDir, 'slice.manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    logger.info('Slice export completed', {
      exportId: run.runId,
      dataset: spec.dataset,
      parquetFiles: 1,
      totalRows: rowCount,
      totalBytes: byteSize,
    });

    return manifest;
  }
}

/**
 * Create ClickHouse slice exporter adapter
 */
export function createClickHouseSliceExporterAdapterImpl(): SliceExporter {
  return new ClickHouseSliceExporterAdapterImpl();
}

