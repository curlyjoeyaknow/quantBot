/**
 * Export OHLCV Slice Handler
 *
 * Pure handler for exporting OHLCV slices as artifacts.
 * Depends on ports only (no direct dependencies on adapters).
 */

import type { Candle } from '@quantbot/core';
import type { ArtifactStorePort } from '@quantbot/core';
import { StorageEngine } from '@quantbot/infra/storage';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { validateCoverage, type CoverageMetrics } from '../coverage/validator.js';
import { writeCandlesToParquet } from '../parquet/writer.js';
import { validateQueryParams } from '../clickhouse/query-builder.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';

export interface ExportOhlcvSliceArgs {
  token: string; // Mint address
  resolution: string; // '1m', '5m', '15m', '1h'
  from: string; // ISO8601 start time
  to: string; // ISO8601 end time
  chain: string; // 'solana' | 'evm'
}

export interface ExportOhlcvSliceResult {
  artifactId?: string;
  deduped: boolean;
  rowCount: number;
  coverage: CoverageMetrics;
}

/**
 * Export OHLCV slice as artifact
 *
 * Pipeline:
 * 1. Query ClickHouse for candles
 * 2. Validate coverage (detect gaps)
 * 3. Write to temp Parquet
 * 4. Publish via ArtifactStorePort
 * 5. Cleanup temp file
 * 6. Return result with coverage metrics
 *
 * @param args - Export arguments
 * @param artifactStore - Artifact store port
 * @returns Export result
 */
export async function exportOhlcvSliceHandler(
  args: ExportOhlcvSliceArgs,
  artifactStore: ArtifactStorePort
): Promise<ExportOhlcvSliceResult> {
  const { token, resolution, from, to, chain } = args;

  logger.info('Exporting OHLCV slice', { token, resolution, from, to, chain });

  // Validate query parameters
  validateQueryParams({
    tokenAddress: token,
    chain,
    interval: resolution,
    dateRange: { from, to },
  });

  // Step 1: Query ClickHouse for candles
  const storageEngine = new StorageEngine();
  const startDateTime = DateTime.fromISO(from, { zone: 'utc' });
  const endDateTime = DateTime.fromISO(to, { zone: 'utc' });

  const candles: Candle[] = await storageEngine.getCandles(
    token,
    chain,
    startDateTime,
    endDateTime,
    {
      interval: resolution,
      useCache: false,
    }
  );

  logger.info('Fetched candles from ClickHouse', { count: candles.length });

  // Step 2: Validate coverage
  const coverage = validateCoverage(candles, resolution, { from, to });

  logger.info('Coverage validation complete', {
    expected: coverage.expectedCandles,
    actual: coverage.actualCandles,
    percent: coverage.coveragePercent.toFixed(2),
    gaps: coverage.gaps.length,
  });

  // If no candles, return early
  if (candles.length === 0) {
    logger.warn('No candles found for slice', { token, resolution, from, to });
    return {
      deduped: false,
      rowCount: 0,
      coverage,
    };
  }

  // Step 3: Write to temp Parquet
  const tempFile = join(tmpdir(), `ohlcv-slice-${randomBytes(8).toString('hex')}.parquet`);

  try {
    await writeCandlesToParquet(candles, tempFile);
    logger.info('Wrote candles to temp Parquet', { path: tempFile, count: candles.length });

    // Step 4: Publish via ArtifactStorePort
    const logicalKey = buildLogicalKey(token, resolution, from, to);

    const publishResult = await artifactStore.publishArtifact({
      artifactType: 'ohlcv_slice_v2',
      schemaVersion: 2,
      logicalKey,
      dataPath: tempFile,
      tags: {
        token,
        resolution,
        chain,
      },
      writerName: 'ohlcv-export',
      writerVersion: '1.0.0',
      gitCommit: process.env.GIT_COMMIT || 'unknown',
      gitDirty: false,
    });

    logger.info('Published OHLCV slice artifact', {
      artifactId: publishResult.artifactId,
      deduped: publishResult.deduped,
    });

    // Step 5: Cleanup temp file
    await unlink(tempFile);
    logger.debug('Cleaned up temp file', { path: tempFile });

    // Step 6: Return result
    return {
      artifactId: publishResult.artifactId,
      deduped: publishResult.deduped,
      rowCount: candles.length,
      coverage,
    };
  } catch (error) {
    // Cleanup temp file on error
    try {
      await unlink(tempFile);
    } catch {
      // Ignore cleanup errors
    }

    logger.error('Failed to export OHLCV slice', error as Error, { token, resolution, from, to });
    throw error;
  }
}

/**
 * Build logical key for OHLCV slice
 *
 * Pattern: token=<mint>/res=<interval>/from=<ISO8601>/to=<ISO8601>
 *
 * @param token - Token mint address
 * @param resolution - Time resolution
 * @param from - Start time (ISO8601)
 * @param to - End time (ISO8601)
 * @returns Logical key
 */
function buildLogicalKey(token: string, resolution: string, from: string, to: string): string {
  return `token=${token}/res=${resolution}/from=${from}/to=${to}`;
}
