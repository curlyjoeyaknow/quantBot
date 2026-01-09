/**
 * Slice Materialiser - Extract minimum viable dataset for CALLS
 *
 * One slice per run. Immutable after creation.
 * Backtest engine never touches ClickHouse.
 *
 * Catalog Integration:
 * - Checks catalog first for existing slices (much faster if already exported)
 * - Queries ClickHouse only for missing time ranges
 * - Merges candles with call_id mapping
 * - Optionally catalogs final result for future reuse
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import type { BacktestPlan, CoverageResult, Slice, Interval } from './types.js';
import { OhlcvRepository } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { submitArtifact } from '@quantbot/infra/utils';
import type { SliceManifestV1 } from '@quantbot/core';

/**
 * Options for materialising slice
 */
export interface MaterialiseSliceOptions {
  /**
   * Optional catalog path for slice reuse.
   * If provided, checks catalog first before querying ClickHouse.
   */
  catalogPath?: string;
  /**
   * Optional flag to catalog the final result for future reuse.
   */
  catalogResult?: boolean;
}

/**
 * Materialise slice - extract candles for eligible calls
 *
 * Creates one parquet file per run with all eligible calls.
 * Uses catalog if provided to reuse existing slices (much faster).
 */
export async function materialiseSlice(
  plan: BacktestPlan,
  coverage: CoverageResult,
  options: MaterialiseSliceOptions = {}
): Promise<Slice> {
  const ohlcvRepo = new OhlcvRepository();
  const runId = randomUUID();

  // Determine interval string
  const intervalMap: Record<number, string> = {
    1: '1s',
    15: '15s',
    60: '1m',
    300: '5m',
    900: '15m',
    3600: '1h',
    14400: '4h',
    86400: '1d',
  };
  const interval = (intervalMap[plan.intervalSeconds] || '1m') as Interval;

  // Create slice directory
  const artifactsDir = join(process.cwd(), 'artifacts', 'backtest', runId);
  await fs.mkdir(artifactsDir, { recursive: true });

  const slicePath = join(artifactsDir, `slice_${interval}.parquet`);

  // Collect all candles for eligible calls
  const allCandles: Array<{
    call_id: string;
    token_address: string;
    chain: string;
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }> = [];

  // OPTIMIZATION: Single bulk ClickHouse query instead of N queries
  // Collect all unique tokens and time windows
  const tokenWindows = new Map<string, { minFrom: DateTime; maxTo: DateTime; callIds: string[] }>();

  for (const eligible of coverage.eligible) {
    const window = plan.perCallWindow.find((w) => w.callId === eligible.callId);
    if (!window) continue;

    const key = `${eligible.tokenAddress}:${eligible.chain}`;
    const existing = tokenWindows.get(key);

    if (existing) {
      existing.minFrom = window.from < existing.minFrom ? window.from : existing.minFrom;
      existing.maxTo = window.to > existing.maxTo ? window.to : existing.maxTo;
      existing.callIds.push(eligible.callId);
    } else {
      tokenWindows.set(key, {
        minFrom: window.from,
        maxTo: window.to,
        callIds: [eligible.callId],
      });
    }
  }

  // Helper to load candles from slice manifest parquet files
  const loadCandlesFromManifest = async (
    manifest: SliceManifestV1,
    tokenAddress: string,
    callWindows: Map<string, { from: DateTime; to: DateTime }>
  ): Promise<
    Array<{
      call_id: string;
      token_address: string;
      chain: string;
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>
  > => {
    const candles: Array<{
      call_id: string;
      token_address: string;
      chain: string;
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }> = [];

    try {
      const { openDuckDb } = await import('@quantbot/storage');
      const conn = await openDuckDb(':memory:');

      // Load parquet files from manifest
      for (const parquetFile of manifest.parquetFiles) {
        // Remove file:// prefix if present
        const filePath = parquetFile.path.replace(/^file:\/\//, '');

        // Check if file exists
        try {
          await fs.access(filePath);
        } catch {
          logger.warn('Parquet file from catalog not found', { path: filePath });
          continue;
        }

        // Read parquet file
        const rows = await conn.all<{
          timestamp: number | string;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
          token_address?: string;
          mint?: string;
        }>(`SELECT * FROM read_parquet('${filePath.replace(/'/g, "''")}')`);

        // Map candles to calls based on time windows
        for (const row of rows) {
          const candleTimestamp =
            typeof row.timestamp === 'string'
              ? DateTime.fromISO(row.timestamp).toUnixInteger()
              : row.timestamp;

          const candleTime = DateTime.fromSeconds(candleTimestamp);

          // Find which call(s) this candle belongs to
          for (const [callId, window] of callWindows.entries()) {
            if (candleTime >= window.from && candleTime <= window.to) {
              candles.push({
                call_id: callId,
                token_address: tokenAddress,
                chain: manifest.spec.chain,
                timestamp: candleTimestamp,
                open: row.open,
                high: row.high,
                low: row.low,
                close: row.close,
                volume: row.volume || 0,
              });
            }
          }
        }
      }
    } catch (error) {
      logger.warn('Error loading candles from catalog manifest', {
        token: tokenAddress,
        manifestId: manifest.manifestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return candles;
  };

  // Single bulk query per token (much faster than N queries)
  // Check catalog first if available
  let catalog: import('@quantbot/labcatalog').Catalog | null = null;
  if (options.catalogPath) {
    try {
      const { Catalog } = await import('@quantbot/labcatalog');
      const { FileSystemCatalogAdapter } = await import('@quantbot/labcatalog');
      const adapter = new FileSystemCatalogAdapter(options.catalogPath);
      catalog = new Catalog(adapter, options.catalogPath);
      logger.info('Using catalog for slice reuse', { catalogPath: options.catalogPath });
    } catch (error) {
      logger.warn('Failed to initialize catalog (will query ClickHouse only)', {
        catalogPath: options.catalogPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Map dataset name from interval
  const datasetMap: Record<string, string> = {
    '1s': 'candles_1s',
    '15s': 'candles_15s',
    '1m': 'candles_1m',
    '5m': 'candles_5m',
    '15m': 'candles_15m',
    '1h': 'candles_1h',
    '4h': 'candles_4h',
    '1d': 'candles_1d',
  };
  const dataset = datasetMap[interval] || 'candles_1m';

  // Single bulk query per token (much faster than N queries)
  for (const [key, { minFrom, maxTo, callIds }] of tokenWindows.entries()) {
    const [tokenAddress, chain] = key.split(':');

    // Build call windows map for this token
    const callWindows = new Map<string, { from: DateTime; to: DateTime }>();
    for (const callId of callIds) {
      const window = plan.perCallWindow.find((w) => w.callId === callId);
      if (window) {
        callWindows.set(callId, { from: window.from, to: window.to });
      }
    }

    let candlesFromCatalog = 0;
    const timeRangesToQuery: Array<{ from: DateTime; to: DateTime }> = [];

    // Check catalog for existing slices
    if (catalog) {
      try {
        const existingSlices = await catalog.findSlices(
          tokenAddress,
          {
            startIso: minFrom.toISO()!,
            endIso: maxTo.toISO()!,
          },
          dataset,
          chain
        );

        if (existingSlices.length > 0) {
          logger.info('Found existing slices in catalog', {
            token: tokenAddress,
            sliceCount: existingSlices.length,
          });

          // Load candles from catalog slices
          for (const manifest of existingSlices) {
            const catalogCandles = await loadCandlesFromManifest(
              manifest,
              tokenAddress,
              callWindows
            );
            allCandles.push(...catalogCandles);
            candlesFromCatalog += catalogCandles.length;
          }

          // Compute gaps: time ranges not covered by catalog slices
          // For simplicity, we'll still query the full range and dedupe
          // (More efficient gap detection could be added later)
          const sliceStart = DateTime.fromISO(existingSlices[0].spec.timeRange.startIso);
          const sliceEnd = DateTime.fromISO(
            existingSlices[existingSlices.length - 1].spec.timeRange.endIso
          );

          // If catalog slices don't fully cover the requested range, query missing parts
          if (sliceStart > minFrom) {
            timeRangesToQuery.push({ from: minFrom, to: sliceStart });
          }
          if (sliceEnd < maxTo) {
            timeRangesToQuery.push({ from: sliceEnd, to: maxTo });
          }

          // If catalog fully covers the range, skip ClickHouse query
          if (sliceStart <= minFrom && sliceEnd >= maxTo) {
            logger.info('Catalog slices fully cover time range, skipping ClickHouse query', {
              token: tokenAddress,
              candlesLoaded: candlesFromCatalog,
            });
            continue; // Skip to next token
          }

          logger.info('Catalog slices partially cover range, querying missing parts', {
            token: tokenAddress,
            catalogCandles: candlesFromCatalog,
            gapsToQuery: timeRangesToQuery.length,
          });
        } else {
          // No catalog slices found, query full range
          timeRangesToQuery.push({ from: minFrom, to: maxTo });
        }
      } catch (error) {
        logger.warn('Error checking catalog (will query ClickHouse)', {
          token: tokenAddress,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall back to full query
        timeRangesToQuery.push({ from: minFrom, to: maxTo });
      }
    } else {
      // No catalog, query full range
      timeRangesToQuery.push({ from: minFrom, to: maxTo });
    }

    // Query ClickHouse for missing time ranges (or full range if no catalog)
    for (const range of timeRangesToQuery) {
      try {
        const candles = await ohlcvRepo.getCandles(tokenAddress, chain, interval, {
          from: range.from,
          to: range.to,
        } as { from: DateTime; to: DateTime });

        // Map candles to calls based on their time windows
        for (const callId of callIds) {
          const window = plan.perCallWindow.find((w) => w.callId === callId);
          if (!window) continue;

          for (const candle of candles) {
            const candleTime = DateTime.fromSeconds(candle.timestamp);
            if (candleTime >= window.from && candleTime <= window.to) {
              allCandles.push({
                call_id: callId,
                token_address: tokenAddress,
                chain: chain,
                timestamp: candle.timestamp,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
              });
            }
          }
        }
      } catch (error) {
        logger.warn('Error loading candles for token', {
          token: tokenAddress,
          callIds,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Write to parquet via DuckDB
  if (allCandles.length > 0) {
    // Use storage's DuckDB adapter
    const { openDuckDb } = await import('@quantbot/storage');
    const conn = await openDuckDb(':memory:');

    // Create table
    await conn.run(`
      CREATE TABLE candles (
        call_id VARCHAR,
        token_address VARCHAR,
        chain VARCHAR,
        timestamp BIGINT,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume DOUBLE
      )
    `);

    // Insert in batches
    const batchSize = 10000;
    for (let i = 0; i < allCandles.length; i += batchSize) {
      const batch = allCandles.slice(i, i + batchSize);
      for (const c of batch) {
        await conn.run(`INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          c.call_id,
          c.token_address,
          c.chain,
          c.timestamp,
          c.open,
          c.high,
          c.low,
          c.close,
          c.volume,
        ]);
      }
    }

    // Export to parquet
    await conn.run(`COPY candles TO '${slicePath}' (FORMAT PARQUET)`);
  }

  logger.info('Slice materialised', {
    path: slicePath,
    calls: coverage.eligible.length,
    candles: allCandles.length,
  });

  // Optionally submit to bus if we have a runId (Phase 2: Bus migration)
  // Note: materialiseSlice generates its own runId, so bus submission is optional
  // Future: Consider passing runId from caller if available
  try {
    await submitArtifact({
      runId,
      producer: 'backtest',
      kind: 'slice',
      artifactId: `slice_${interval}`,
      parquetPath: slicePath,
      schemaHint: 'backtest.slice',
      rows: allCandles.length,
      meta: {
        interval,
        eligibleCalls: coverage.eligible.length,
        totalCandles: allCandles.length,
      },
    });
    logger.info('Slice submitted to bus', { runId, path: slicePath });
  } catch (error) {
    // Don't fail if bus submission fails - slice is still written locally
    logger.warn('Failed to submit slice to bus (slice still written locally)', {
      runId,
      path: slicePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    path: slicePath,
    format: 'parquet',
    interval,
    callIds: coverage.eligible.map((e) => e.callId),
  };
}
