/**
 * Slice Materialization Service
 *
 * CRITICAL: OHLCV data is stored in ClickHouse, NOT DuckDB.
 *
 * This service:
 * 1. Computes the exact time periods needed for each token
 * 2. Fetches candles from ClickHouse (via StorageEngine -> OhlcvRepository)
 * 3. Exports them as slice files (JSON for now, Parquet/Arrow can be added later)
 *
 * The simulator consumes these slices, never queries ClickHouse directly.
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { DateTime } from 'luxon';
import { getStorageEngine } from '@quantbot/storage';
import type { RunPlan } from './planRun.js';
import type { WorkflowContext } from '../types.js';
// Import Candle type from engine module
// The engine exports Candle from sim_types.ts
type Candle = {
  ts: string; // ISO timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
};
import { getArtifactsDir } from '@quantbot/core';

export interface SliceMetadata {
  token: string;
  interval: string;
  from: string; // ISO timestamp
  to: string; // ISO timestamp
  candleCount: number;
  slicePath: string;
}

export interface SlicePlan {
  slicePaths: Map<string, string>; // token -> slicePath
  sliceMetadata: SliceMetadata[];
  baseDir: string;
}

const CHAIN = 'solana' as const;

/**
 * Convert storage engine candle to simulator candle format
 */
function toSimulatorCandle(candle: {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): Candle {
  // Convert timestamp to ISO string
  const ts = DateTime.fromSeconds(candle.timestamp).toISO();
  if (!ts) {
    throw new Error(`Invalid timestamp: ${candle.timestamp}`);
  }

  return {
    ts,
    o: candle.open,
    h: candle.high,
    l: candle.low,
    c: candle.close,
    v: candle.volume,
  };
}

/**
 * Materialize slices for eligible tokens
 *
 * Fetches candles from ClickHouse and writes them to JSON slice files.
 *
 * @param plan - Run plan with token requirements
 * @param eligibleTokens - Array of eligible token addresses
 * @param ctx - Workflow context
 * @param runId - Run ID for organizing slices
 * @returns Slice plan with paths and metadata
 */
export async function materializeSlices(
  plan: RunPlan,
  eligibleTokens: string[],
  ctx: WorkflowContext,
  runId: string
): Promise<SlicePlan> {
  const storageEngine = getStorageEngine();
  const artifactsDir = getArtifactsDir();
  const slicesDir = join(artifactsDir, runId, 'slices');

  // Create slices directory
  await mkdir(slicesDir, { recursive: true });

  const slicePaths = new Map<string, string>();
  const sliceMetadata: SliceMetadata[] = [];

  // Normalize interval for storage engine
  const normalizedInterval = plan.interval.toLowerCase();
  const storageInterval: '1s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d' =
    normalizedInterval === '1h' || normalizedInterval === '1H'
      ? '1h'
      : (normalizedInterval as '1s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d');

  // Materialize slice for each eligible token
  for (const token of eligibleTokens) {
    // Find requirement for this token
    const req = plan.tokenRequirements.find((r) => r.token === token);
    if (!req) {
      ctx.logger.warn('No requirement found for eligible token', { token });
      continue;
    }

    try {
      // Fetch candles from ClickHouse (StorageEngine.getCandles() queries ClickHouse via OhlcvRepository)
      // NOTE: OHLCV data is NOT in DuckDB - it's in ClickHouse or Parquet files
      const candles = await storageEngine.getCandles(
        token,
        CHAIN,
        req.requiredFromTs,
        req.requiredToTs,
        {
          interval: storageInterval,
          useCache: false, // Don't use cache - we want fresh data for slices
          forceRefresh: true, // Force fetch from ClickHouse
        }
      );

      if (candles.length === 0) {
        ctx.logger.warn('No candles found for token in required range', {
          token,
          from: req.requiredFromTs.toISO(),
          to: req.requiredToTs.toISO(),
        });
        continue;
      }

      // Convert to simulator candle format
      const simulatorCandles = candles.map(toSimulatorCandle);

      // Write slice file (JSON format)
      const sliceFileName = `slice_${token.slice(0, 8)}_${plan.interval}.json`;
      const slicePath = join(slicesDir, sliceFileName);

      await writeFile(slicePath, JSON.stringify(simulatorCandles, null, 2), 'utf8');

      slicePaths.set(token, slicePath);

      const fromISO = req.requiredFromTs.toISO();
      const toISO = req.requiredToTs.toISO();
      if (!fromISO || !toISO) {
        ctx.logger.warn('Invalid ISO timestamp for slice metadata', { token });
        continue;
      }

      sliceMetadata.push({
        token,
        interval: plan.interval,
        from: fromISO,
        to: toISO,
        candleCount: simulatorCandles.length,
        slicePath,
      });

      if (ctx.logger.debug) {
        ctx.logger.debug('Slice materialized', {
          token,
          candleCount: simulatorCandles.length,
          slicePath,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.logger.error('Failed to materialize slice for token', {
        token,
        error: errorMessage,
      });
      // Continue with other tokens
    }
  }

  ctx.logger.info('Slice materialization completed', {
    totalTokens: eligibleTokens.length,
    slicesCreated: slicePaths.size,
  });

  return {
    slicePaths,
    sliceMetadata,
    baseDir: slicesDir,
  };
}

/**
 * Load candles from a slice file
 *
 * @param slicePath - Path to slice JSON file
 * @returns Array of candles
 */
export async function loadSlice(slicePath: string): Promise<Candle[]> {
  const { readFile } = await import('fs/promises');
  const content = await readFile(slicePath, 'utf8');
  return JSON.parse(content) as Candle[];
}
