/**
 * ClickHouse -> Parquet exporter adapter implementation
 *
 * Simple, working implementation for 1m OHLCV candles.
 * Start with one dataset, one filter mode, one Parquet file.
 */

import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { getClickHouseClient } from '../clickhouse-client.js';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger } from '@quantbot/utils';
import { readAllBytes } from '../utils/readAllBytes.js';
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
const CONNECTION_TIMEOUT_MS = 10000; // 10 seconds for connection establishment

/**
 * Error classification for better error handling
 */
export interface ClickHouseErrorInfo {
  isRetryable: boolean;
  isTimeout: boolean;
  isConnectionError: boolean;
  isQueryError: boolean;
  category: 'network' | 'timeout' | 'query' | 'unknown';
  userMessage: string;
}

/**
 * Classify ClickHouse error for appropriate handling
 */
function classifyError(error: unknown): ClickHouseErrorInfo {
  if (!(error instanceof Error)) {
    return {
      isRetryable: false,
      isTimeout: false,
      isConnectionError: false,
      isQueryError: false,
      category: 'unknown',
      userMessage: 'Unknown error occurred',
    };
  }

  const message = error.message.toLowerCase();
  const isSocketError =
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('connection') ||
    message.includes('network');
  const isTimeout =
    message.includes('timeout') ||
    message.includes('etimedout') ||
    message.includes('max_execution_time') ||
    message.includes('timed out');
  const isQueryError =
    message.includes('syntax') ||
    message.includes('parse') ||
    message.includes('invalid') ||
    message.includes('table') ||
    message.includes('column') ||
    message.includes('database');

  const isRetryable = (isSocketError || isTimeout) && !isQueryError;

  let category: 'network' | 'timeout' | 'query' | 'unknown';
  let userMessage: string;

  if (isQueryError) {
    category = 'query';
    userMessage = `Query error: ${error.message}. Please check your query syntax and table/column names.`;
  } else if (isTimeout) {
    category = 'timeout';
    userMessage = `Query timed out after ${QUERY_TIMEOUT_SECONDS} seconds. The query may be too large or the server is overloaded.`;
  } else if (isSocketError) {
    category = 'network';
    userMessage = `Network error: ${error.message}. Please check your ClickHouse connection.`;
  } else {
    category = 'unknown';
    userMessage = `Unexpected error: ${error.message}`;
  }

  return {
    isRetryable,
    isTimeout,
    isConnectionError: isSocketError,
    isQueryError,
    category,
    userMessage,
  };
}

/**
 * Execute ClickHouse query with retry logic and comprehensive error handling
 */
async function executeQueryWithRetry<T>(
  queryFn: () => Promise<T>,
  queryDescription: string,
  context?: Record<string, unknown>
): Promise<T> {
  let lastError: Error | null = null;
  let lastErrorInfo: ClickHouseErrorInfo | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await queryFn();
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastErrorInfo = classifyError(error);

      // Log error with context
      logger.warn(`ClickHouse query failed (attempt ${attempt + 1}/${MAX_RETRIES})`, {
        query: queryDescription,
        error: lastError.message,
        category: lastErrorInfo.category,
        isRetryable: lastErrorInfo.isRetryable,
        ...context,
      });

      // Check if error is retryable
      if (!lastErrorInfo.isRetryable || attempt === MAX_RETRIES - 1) {
        // Not retryable or last attempt - throw with enhanced error message
        const enhancedError = new Error(
          `${lastErrorInfo.userMessage} (after ${attempt + 1} attempt${attempt > 0 ? 's' : ''})`
        );
        enhancedError.cause = lastError;
        throw enhancedError;
      }

      // Calculate exponential backoff delay
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      logger.info(`Retrying ClickHouse query after ${delay}ms...`, {
        query: queryDescription,
        attempt: attempt + 1,
        maxRetries: MAX_RETRIES,
        delayMs: delay,
      });

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  if (lastErrorInfo) {
    const enhancedError = new Error(
      `${lastErrorInfo.userMessage} (exhausted ${MAX_RETRIES} retries)`
    );
    enhancedError.cause = lastError;
    throw enhancedError;
  }
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

    // Time range - use parseDateTimeBestEffort to handle ISO format with milliseconds
    conditions.push(`timestamp >= parseDateTimeBestEffort('${spec.timeRange.startIso}')`);
    conditions.push(`timestamp < parseDateTimeBestEffort('${spec.timeRange.endIso}')`);

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
        ? spec.columns.map((col: string) => (col === 'interval' ? '`interval`' : col)).join(', ')
        : 'token_address, chain, timestamp, `interval`, open, high, low, close, volume';

    // Query ClickHouse and export to CSV (ClickHouse doesn't support Parquet format)
    // We'll convert CSV to Parquet using DuckDB after export
    const query = `
      SELECT ${columns}
      FROM ${tableName}
      WHERE ${whereClause}
      ORDER BY token_address, timestamp
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
    try {
      result = await executeQueryWithRetry(
        () =>
          ch.query({
            query,
            format: 'CSVWithNames', // CSV with header row (ClickHouse doesn't support Parquet)
            clickhouse_settings: {
              max_execution_time: QUERY_TIMEOUT_SECONDS,
              connect_timeout: CONNECTION_TIMEOUT_MS / 1000, // Convert to seconds
            },
          }),
        'Parquet export query',
        {
          dataset: spec.dataset,
          chain: spec.chain,
          timeRange: spec.timeRange,
          tokenCount: spec.tokenIds?.length ?? 0,
        }
      );
    } catch (error: unknown) {
      const errorInfo = classifyError(error);
      logger.error('Failed to execute ClickHouse Parquet export query', error as Error, {
        dataset: spec.dataset,
        chain: spec.chain,
        timeRange: spec.timeRange,
        category: errorInfo.category,
        isRetryable: errorInfo.isRetryable,
        query: query.substring(0, 200), // Log first 200 chars of query
      });
      // Re-throw with enhanced error message
      throw error;
    }

    // Read CSV data from stream with error handling
    // ClickHouse client returns different structures depending on format
    // For CSVWithNames, result.stream may be a function that returns the actual stream
    let csvData: Buffer;
    try {
      // Fix call site: handle result.stream as function or property
       
      const streamSource =
        typeof (result as any).stream === 'function'
          ? await (result as any).stream()
          : ((result as any).stream ?? (result as any).body ?? result);

      const streamBytes = await readAllBytes(streamSource);
      csvData = Buffer.from(streamBytes);
    } catch (error: unknown) {
      logger.error('Failed to read CSV stream from ClickHouse', error as Error, {
        dataset: spec.dataset,
        runId: run.runId,
        // Debug info
        resultKeys: result ? Object.keys(result) : [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        streamType: typeof (result as any)?.stream,
      });
      throw new Error(
        `Failed to read CSV stream: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Convert CSV to Parquet using DuckDB
    // ClickHouse doesn't support Parquet format, so we export CSV and convert
    let parquetData: Buffer;

    // Check if CSV is empty or only has header row (no data)
    const csvString = csvData.toString();
    const csvLines = csvString
      .trim()
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const hasOnlyHeaders = csvLines.length <= 1;

    if (csvData.length === 0 || hasOnlyHeaders) {
      // Create empty Parquet file with correct schema (0 rows) so DuckDB can read it
      // This ensures the schema is preserved even when there's no data
      const tempParquetPath = join(
        tmpdir(),
        `slice-export-empty-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`
      );

      try {
        const duckdb = new DuckDBClient(':memory:');
        // Create table with correct schema matching the expected columns
        // Default columns: token_address, chain, timestamp, interval, open, high, low, close, volume
        await duckdb.execute(`
          CREATE TABLE temp_empty (
            token_address VARCHAR,
            chain VARCHAR,
            timestamp TIMESTAMP,
            interval VARCHAR,
            open DOUBLE,
            high DOUBLE,
            low DOUBLE,
            close DOUBLE,
            volume DOUBLE
          );
          COPY temp_empty TO '${tempParquetPath.replace(/'/g, "''")}' (FORMAT PARQUET);
        `);
        await duckdb.close();

        // Read empty Parquet file
        parquetData = await fs.readFile(tempParquetPath);
        await fs.unlink(tempParquetPath).catch(() => {});
        logger.info('Created empty Parquet file with schema for empty CSV result');
      } catch (error) {
        logger.error('Failed to create empty Parquet file with schema', error as Error);
        // Fallback: return empty buffer (will be handled by analyzer)
        parquetData = Buffer.alloc(0);
      }
    } else {
      // Write CSV to temp file
      const tempCsvPath = join(
        tmpdir(),
        `slice-export-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`
      );
      const tempParquetPath = join(
        tmpdir(),
        `slice-export-${Date.now()}-${Math.random().toString(36).slice(2)}.parquet`
      );

      try {
        await fs.writeFile(tempCsvPath, csvData);

        // Use DuckDB to convert CSV to Parquet
        const duckdb = new DuckDBClient(':memory:');
        await duckdb.execute(`
          CREATE TABLE temp_csv AS SELECT * FROM read_csv_auto('${tempCsvPath.replace(/'/g, "''")}');
          COPY temp_csv TO '${tempParquetPath.replace(/'/g, "''")}' (FORMAT PARQUET);
        `);
        await duckdb.close();

        // Read Parquet file
        parquetData = await fs.readFile(tempParquetPath);

        // Cleanup temp files
        await fs.unlink(tempCsvPath).catch(() => {});
        await fs.unlink(tempParquetPath).catch(() => {});
      } catch (error) {
        // Cleanup on error
        await fs.unlink(tempCsvPath).catch(() => {});
        await fs.unlink(tempParquetPath).catch(() => {});
        logger.error('Failed to convert CSV to Parquet', error as Error);
        throw new Error(
          `Failed to convert CSV to Parquet: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Handle empty result set with improved validation and user feedback
    if (parquetData.length === 0) {
      logger.warn('Empty result set from ClickHouse query', {
        dataset: spec.dataset,
        chain: spec.chain,
        timeRange: spec.timeRange,
        runId: run.runId,
        tokenCount: spec.tokenIds?.length ?? 0,
        message:
          'No data found matching the query criteria. This may indicate: 1) No data exists for the time range, 2) Token addresses are incorrect, 3) Data has not been ingested yet.',
      });

      // Validate that the query itself is valid by checking if table exists and has data
      let rowCount = 0;
      let hasDataInTable = false;
      let hasDataInTimeRange = false;
      try {
        // First, check if table has any data at all
        const tableCheckQuery = `SELECT count(*) as cnt FROM ${tableName} LIMIT 1`;
        const tableCheckResult = await executeQueryWithRetry(
          () =>
            ch.query({
              query: tableCheckQuery,
              format: 'JSONEachRow',
              clickhouse_settings: {
                max_execution_time: 30,
              },
            }),
          'Table existence check',
          { dataset: spec.dataset }
        );
        const tableCheckData = (await tableCheckResult.json()) as Array<{ cnt: string }>;
        hasDataInTable =
          tableCheckData.length > 0 && parseInt(tableCheckData[0].cnt || '0', 10) > 0;

        // Then check if data exists in the time range
        const timeRangeCheckQuery = `
          SELECT count(*) as cnt
          FROM ${tableName}
          WHERE timestamp >= parseDateTimeBestEffort('${spec.timeRange.startIso}') AND timestamp < parseDateTimeBestEffort('${spec.timeRange.endIso}')
        `;
        const timeRangeCheckResult = await executeQueryWithRetry(
          () =>
            ch.query({
              query: timeRangeCheckQuery,
              format: 'JSONEachRow',
              clickhouse_settings: {
                max_execution_time: 30,
              },
            }),
          'Time range check',
          { timeRange: spec.timeRange }
        );
        const timeRangeCheckData = (await timeRangeCheckResult.json()) as Array<{ cnt: string }>;
        hasDataInTimeRange =
          timeRangeCheckData.length > 0 && parseInt(timeRangeCheckData[0].cnt || '0', 10) > 0;

        // Get exact row count for the full query
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
          'Row count query',
          { whereClause: whereClause.substring(0, 200) }
        );
        const countData = (await countResult.json()) as Array<{ cnt: string }>;
        rowCount = countData.length > 0 ? parseInt(countData[0].cnt || '0', 10) : 0;

        // Log diagnostic information
        logger.info('Empty result set diagnostics', {
          hasDataInTable,
          hasDataInTimeRange,
          rowCount,
          tokenFilter: spec.tokenIds ? `${spec.tokenIds.length} tokens` : 'none',
          interval,
          chain: spec.chain,
        });
      } catch (error: unknown) {
        logger.warn('Failed to get diagnostic information for empty result', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with rowCount = 0
      }

      // Create empty Parquet file to maintain consistency
      const parquetPath = join(outDir, 'part-000.parquet');
      await fs.writeFile(parquetPath, Buffer.alloc(0)); // Empty file

      // Create manifest for empty result with diagnostic metadata
      const createdAtIso = new Date().toISOString();
      const specHash = hash(JSON.stringify({ run, spec, layout }));

      // Ensure path is absolute before adding file:// prefix
      // Use resolve to ensure absolute path, then normalize
      const absoluteParquetPath = resolve(parquetPath).replace(/\\/g, '/');

      const emptyManifest: SliceManifestV1 = {
        version: 1,
        manifestId: hash(`manifest:${specHash}:${createdAtIso}`),
        createdAtIso,
        run,
        spec,
        layout,
        parquetFiles: [
          {
            path: `file://${absoluteParquetPath}`,
            rowCount: 0,
            byteSize: 0,
            dt: day,
          },
        ],
        summary: {
          totalFiles: 1,
          totalRows: 0,
          totalBytes: 0,
          // Include diagnostic info in summary for better user feedback
          // Note: This is a non-standard field, but useful for debugging
          ...(hasDataInTable !== undefined && {
            _diagnostics: {
              hasDataInTable,
              hasDataInTimeRange,
              message: hasDataInTable
                ? hasDataInTimeRange
                  ? 'No data matches the token/chain/interval filters'
                  : 'No data in the specified time range'
                : 'Table is empty or does not exist',
            },
          }),
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
        hasDataInTable,
        hasDataInTimeRange,
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

    // Ensure path is absolute before adding file:// prefix
    // Use resolve to ensure absolute path, then normalize
    const absoluteParquetPath = resolve(parquetPath).replace(/\\/g, '/');

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
          path: `file://${absoluteParquetPath}`,
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
