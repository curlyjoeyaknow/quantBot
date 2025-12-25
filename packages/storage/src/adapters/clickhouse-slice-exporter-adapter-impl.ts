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
import type {
  SliceExporter,
  ParquetLayoutSpec,
  RunContext,
  SliceManifestV1,
  SliceSpec,
} from '@quantbot/core';

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
 * Retry configuration
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Start with 1 second
const QUERY_TIMEOUT_SECONDS = 60; // 60 seconds for large queries

/**
 * Check if error is retryable (transient network/connection errors)
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('connection')
  );
}

/**
 * Execute ClickHouse query with retry logic
 */
async function executeQueryWithRetry<T>(
  queryFn: () => Promise<T>,
  queryDescription: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await queryFn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryableError(error) || attempt === MAX_RETRIES - 1) {
        // Not retryable or last attempt - throw immediately
        throw lastError;
      }

      // Calculate exponential backoff delay
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      logger.warn(`ClickHouse query failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`, {
        query: queryDescription,
        error: lastError.message,
        delayMs: delay,
      });

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError || new Error('Query failed after retries');
}

/**
 * Dataset to interval mapping
 */
const DATASET_INTERVAL_MAP: Record<string, string> = {
  candles_1s: '1s',
  candles_15s: '15s',
  candles_1m: '1m',
};

/**
 * ClickHouse Slice Exporter Adapter - Working Implementation
 *
 * Currently supports:
 * - Datasets: "candles_1s", "candles_15s", "candles_1m" (maps to ohlcv_candles table with corresponding interval)
 * - Simple filters: time range + optional tokenIds
 * - Single Parquet file output
 * - Retry logic for transient errors
 * - Timeout handling
 * - Empty result set handling
 */
export class ClickHouseSliceExporterAdapterImpl implements SliceExporter {
  async exportSlice(args: {
    run: RunContext;
    spec: SliceSpec;
    layout: ParquetLayoutSpec;
  }): Promise<SliceManifestV1> {
    const { run, spec, layout } = args;

    // Validate dataset and get interval
    const interval = DATASET_INTERVAL_MAP[spec.dataset];
    if (!interval) {
      const supportedDatasets = Object.keys(DATASET_INTERVAL_MAP).join(', ');
      throw new Error(
        `Unsupported dataset: ${spec.dataset}. Supported datasets: ${supportedDatasets}`
      );
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

    // Interval (from dataset mapping)
    const escapedInterval = interval.replace(/'/g, "''");
    conditions.push(`\`interval\` = '${escapedInterval}'`);

    // Token filter
    if (spec.tokenIds && spec.tokenIds.length > 0) {
      const tokenList = spec.tokenIds.map((t: string) => `'${t.replace(/'/g, "''")}'`).join(', ');
      conditions.push(`token_address IN (${tokenList})`);
    }

    const whereClause = conditions.join(' AND ');

    // Select columns (or all if not specified)
    // Note: interval is a reserved keyword in ClickHouse, must be escaped with backticks
    const columns =
      spec.columns && spec.columns.length > 0
        ? spec.columns.map((col) => (col === 'interval' ? '`interval`' : col)).join(', ')
        : 'token_address, chain, timestamp, `interval`, open, high, low, close, volume';

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
      interval,
      chain: spec.chain,
      timeRange: spec.timeRange,
      tokenCount: spec.tokenIds?.length ?? 0,
    });

    // Execute query with retry logic and timeout
    let result;
    let parquetData: Buffer;
    try {
      result = await executeQueryWithRetry(
        () =>
          ch.query({
            query,
            format: 'Parquet',
            clickhouse_settings: {
              max_execution_time: QUERY_TIMEOUT_SECONDS,
            },
          }),
        'Parquet export query'
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to execute ClickHouse Parquet export query', error as Error, {
        dataset: spec.dataset,
        chain: spec.chain,
        timeRange: spec.timeRange,
        query: query.substring(0, 200), // Log first 200 chars of query
      });
      throw new Error(
        `ClickHouse export failed after ${MAX_RETRIES} retries: ${errorMessage}`
      );
    }

    // Read Parquet data from stream with error handling
    const stream = result.stream;
    const chunks: Buffer[] = [];

    try {
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
    } catch (error: unknown) {
      logger.error('Failed to read Parquet stream from ClickHouse', error as Error, {
        dataset: spec.dataset,
        runId: run.runId,
      });
      throw new Error(
        `Failed to read Parquet stream: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    parquetData = Buffer.concat(chunks);

    // Handle empty result set
    if (parquetData.length === 0) {
      logger.info('Empty result set from ClickHouse query', {
        dataset: spec.dataset,
        chain: spec.chain,
        timeRange: spec.timeRange,
        runId: run.runId,
      });
      // Still create manifest with empty file list (or create empty Parquet file)
      // For now, we'll create an empty Parquet file to maintain consistency
      const parquetPath = join(outDir, 'part-000.parquet');
      await fs.writeFile(parquetPath, Buffer.alloc(0)); // Empty file

      // Get row count (will be 0 for empty result)
      let rowCount = 0;
      try {
        const countQuery = `
          SELECT count(*) as cnt
          FROM ${tableName}
          WHERE ${whereClause}
        `;
        const countResult = await executeQueryWithRetry(
          () =>
            ch.query({
              query: countQuery,
              format: 'JSONEachRow',
              clickhouse_settings: {
                max_execution_time: 30,
              },
            }),
          'Row count query'
        );
        const countData = (await countResult.json()) as Array<{ cnt: string }>;
        rowCount = countData.length > 0 ? parseInt(countData[0].cnt || '0', 10) : 0;
      } catch (error: unknown) {
        logger.warn('Failed to get row count for empty result', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with rowCount = 0
      }

      // Create manifest for empty result
      const createdAtIso = new Date().toISOString();
      const specHash = hash(JSON.stringify({ run, spec, layout }));

      const emptyManifest: SliceManifestV1 = {
        version: 1,
        manifestId: hash(`manifest:${specHash}:${createdAtIso}`),
        createdAtIso,
        run,
        spec,
        layout,
        parquetFiles: [
          {
            path: parquetPath,
            rowCount: 0,
            byteSize: 0,
            dt: day,
          },
        ],
        summary: {
          totalFiles: 1,
          totalRows: 0,
          totalBytes: 0,
        },
        integrity: {
          specHash,
        },
      };

      // Write manifest
      const manifestPath = join(outDir, 'slice.manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(emptyManifest, null, 2), 'utf-8');

      logger.info('Slice export completed (empty result)', {
        exportId: run.runId,
        dataset: spec.dataset,
        parquetFiles: 1,
        totalRows: 0,
      });

      return emptyManifest;
    }

    // Write Parquet file for non-empty result
    const parquetPath = join(outDir, 'part-000.parquet');
    try {
      await fs.writeFile(parquetPath, parquetData);
    } catch (error: unknown) {
      logger.error('Failed to write Parquet file', error as Error, {
        path: parquetPath,
        size: parquetData.length,
      });
      throw new Error(
        `Failed to write Parquet file: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Get row count (query separately since Parquet format doesn't include it)
    let rowCount = 0;
    try {
      const countQuery = `
        SELECT count(*) as cnt
        FROM ${tableName}
        WHERE ${whereClause}
      `;
      const countResult = await executeQueryWithRetry(
        () =>
          ch.query({
            query: countQuery,
            format: 'JSONEachRow',
            clickhouse_settings: {
              max_execution_time: 30,
            },
          }),
        'Row count query'
      );
      const countData = (await countResult.json()) as Array<{ cnt: string }>;
      rowCount = countData.length > 0 ? parseInt(countData[0].cnt || '0', 10) : 0;
    } catch (error: unknown) {
      logger.warn('Failed to get row count, using file size estimate', {
        error: error instanceof Error ? error.message : String(error),
      });
      // If count query fails, we can't determine exact row count, but we'll continue
      // The manifest will have rowCount as undefined or 0
    }

    // Get file size
    let byteSize = 0;
    try {
      const stats = await fs.stat(parquetPath);
      byteSize = stats.size;
    } catch (error: unknown) {
      logger.warn('Failed to get file size', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Use parquetData.length as fallback
      byteSize = parquetData.length;
    }

    // Get observed time range (with retry)
    let timeRangeObserved: { startIso: string; endIso: string } | undefined = undefined;
    try {
      const timeRangeQuery = `
        SELECT 
          min(timestamp) as min_ts,
          max(timestamp) as max_ts
        FROM ${tableName}
        WHERE ${whereClause}
      `;
      const timeRangeResult = await executeQueryWithRetry(
        () =>
          ch.query({
            query: timeRangeQuery,
            format: 'JSONEachRow',
            clickhouse_settings: {
              max_execution_time: 30,
            },
          }),
        'Time range query'
      );
      const timeRangeData = (await timeRangeResult.json()) as Array<{
        min_ts: string;
        max_ts: string;
      }>;
      timeRangeObserved =
        timeRangeData.length > 0 && timeRangeData[0].min_ts && timeRangeData[0].max_ts
          ? {
              startIso: timeRangeData[0].min_ts,
              endIso: timeRangeData[0].max_ts,
            }
          : undefined;
    } catch (error: unknown) {
      logger.warn('Failed to get observed time range', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue without time range observed
    }

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
