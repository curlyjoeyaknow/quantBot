/**
 * OHLCV Gap Audit Handler
 *
 * Audits OHLCV data for gaps, duplicates, and completeness.
 * Outputs per token+interval: expected_count, actual_count, gap_count, dup_count, min_ts, max_ts, SAFE/UNSAFE flag.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { getClickHouseClient } from '@quantbot/storage';
import { DateTime } from 'luxon';
import { getIntervalSeconds } from '@quantbot/simulation';
import type { CandleInterval } from '@quantbot/simulation';
import type { Candle } from '@quantbot/core';

const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

export const auditGapsSchema = z.object({
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type AuditGapsArgs = z.infer<typeof auditGapsSchema>;

export interface GapAuditResult {
  token_address: string;
  chain: string;
  interval: string;
  expected_count: number;
  actual_count: number;
  gap_count: number;
  dup_count: number;
  min_ts: number | null;
  max_ts: number | null;
  min_ts_iso: string | null;
  max_ts_iso: string | null;
  status: 'SAFE' | 'UNSAFE';
}

/**
 * Get all distinct token_address + interval combinations from ClickHouse
 */
async function getAllTokenIntervals(chain?: string): Promise<Array<{ token_address: string; chain: string; interval: string }>> {
  const ch = getClickHouseClient();

  let query = `
    SELECT DISTINCT
      token_address,
      chain,
      \`interval\`
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
  `;

  if (chain) {
    const escapedChain = chain.replace(/'/g, "''");
    query += ` WHERE chain = '${escapedChain}'`;
  }

  query += ` ORDER BY token_address, chain, \`interval\``;

  try {
    const result = await ch.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const data = (await result.json()) as Array<{
      token_address: string;
      chain: string;
      interval: string;
    }>;

    return data || [];
  } catch (error) {
    throw new Error(`Failed to query token intervals: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get all candles for a token+interval combination
 */
async function getAllCandles(tokenAddress: string, chain: string, interval: string): Promise<Candle[]> {
  const ch = getClickHouseClient();

  const escapedTokenAddress = tokenAddress.replace(/'/g, "''");
  const escapedChain = chain.replace(/'/g, "''");
  const escapedInterval = interval.replace(/'/g, "''");

  const query = `
    SELECT 
      toUnixTimestamp(timestamp) as timestamp,
      open,
      high,
      low,
      close,
      volume
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
    WHERE token_address = '${escapedTokenAddress}'
      AND chain = '${escapedChain}'
      AND \`interval\` = '${escapedInterval}'
    ORDER BY timestamp ASC
  `;

  try {
    const result = await ch.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 60,
      },
    });

    const data = (await result.json()) as Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;

    return (data || []).map((row) => ({
      timestamp: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
  } catch (error) {
    throw new Error(
      `Failed to query candles for ${tokenAddress}/${chain}/${interval}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Normalize interval string to match CandleInterval type
 */
function normalizeInterval(interval: string): CandleInterval {
  const normalized = interval.toLowerCase();
  // Map common variations to CandleInterval
  if (normalized === '1h' || normalized === '1H') return '1H';
  if (normalized === '4h' || normalized === '4H') return '4H';
  if (normalized === '1d' || normalized === '1D') return '1D';
  if (normalized === '15s') return '15s';
  if (normalized === '1m') return '1m';
  if (normalized === '5m') return '5m';
  if (normalized === '15m') return '15m';
  // Default fallback
  return '5m';
}

/**
 * Get interval seconds with fallback for unknown intervals
 */
function getIntervalSecondsSafe(interval: string): number {
  try {
    const normalized = normalizeInterval(interval);
    return getIntervalSeconds(normalized);
  } catch {
    // Fallback: try to parse common patterns
    const normalized = interval.toLowerCase();
    if (normalized.endsWith('s')) {
      const seconds = parseInt(normalized.slice(0, -1), 10);
      if (!isNaN(seconds)) return seconds;
    }
    if (normalized.endsWith('m')) {
      const minutes = parseInt(normalized.slice(0, -1), 10);
      if (!isNaN(minutes)) return minutes * 60;
    }
    if (normalized.endsWith('h')) {
      const hours = parseInt(normalized.slice(0, -1), 10);
      if (!isNaN(hours)) return hours * 3600;
    }
    if (normalized.endsWith('d')) {
      const days = parseInt(normalized.slice(0, -1), 10);
      if (!isNaN(days)) return days * 86400;
    }
    // Ultimate fallback: 5 minutes
    return 300;
  }
}

/**
 * Calculate gap and duplicate counts for candles
 */
function calculateGapsAndDups(candles: Candle[], interval: string): { gapCount: number; dupCount: number; expectedCount: number } {
  if (candles.length === 0) {
    return { gapCount: 0, dupCount: 0, expectedCount: 0 };
  }

  // Get interval in seconds (with fallback for unknown intervals)
  const intervalSeconds = getIntervalSecondsSafe(interval);

  // Sort by timestamp
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  const minTs = sorted[0].timestamp;
  const maxTs = sorted[sorted.length - 1].timestamp;

  // Calculate expected count
  const timeRange = maxTs - minTs;
  const expectedCount = Math.floor(timeRange / intervalSeconds) + 1;

  // Count duplicates (same timestamp)
  const timestampCounts = new Map<number, number>();
  for (const candle of sorted) {
    timestampCounts.set(candle.timestamp, (timestampCounts.get(candle.timestamp) || 0) + 1);
  }
  const dupCount = Array.from(timestampCounts.values()).reduce((sum, count) => sum + (count > 1 ? count - 1 : 0), 0);

  // Count gaps
  let gapCount = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i].timestamp;
    const next = sorted[i + 1].timestamp;
    const expectedNext = current + intervalSeconds;

    // If next timestamp is more than one interval away, there's a gap
    if (next > expectedNext) {
      // Calculate how many intervals are missing
      const missingIntervals = Math.floor((next - expectedNext) / intervalSeconds);
      gapCount += missingIntervals;
    }
  }

  return { gapCount, dupCount, expectedCount };
}

/**
 * Audit handler - audits all token+interval combinations for gaps
 */
export async function auditGapsHandler(args: AuditGapsArgs, _ctx: CommandContext): Promise<GapAuditResult[]> {
  // Get all token+interval combinations
  const tokenIntervals = await getAllTokenIntervals(args.chain);

  const results: GapAuditResult[] = [];

  // Process each token+interval combination
  for (const { token_address, chain, interval } of tokenIntervals) {
    try {
      // Get all candles for this token+interval
      const candles = await getAllCandles(token_address, chain, interval);

      if (candles.length === 0) {
        results.push({
          token_address,
          chain,
          interval,
          expected_count: 0,
          actual_count: 0,
          gap_count: 0,
          dup_count: 0,
          min_ts: null,
          max_ts: null,
          min_ts_iso: null,
          max_ts_iso: null,
          status: 'UNSAFE',
        });
        continue;
      }

      // Calculate gaps and duplicates
      const { gapCount, dupCount, expectedCount } = calculateGapsAndDups(candles, interval);

      // Get min/max timestamps
      const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
      const minTs = sorted[0].timestamp;
      const maxTs = sorted[sorted.length - 1].timestamp;

      // Determine SAFE/UNSAFE status
      // SAFE = no gaps, no duplicates, actual_count matches expected_count (within 1% tolerance)
      const tolerance = Math.max(1, Math.floor(expectedCount * 0.01)); // 1% tolerance, minimum 1
      const countMatch = Math.abs(candles.length - expectedCount) <= tolerance;
      const status: 'SAFE' | 'UNSAFE' = gapCount === 0 && dupCount === 0 && countMatch ? 'SAFE' : 'UNSAFE';

      results.push({
        token_address,
        chain,
        interval,
        expected_count: expectedCount,
        actual_count: candles.length,
        gap_count: gapCount,
        dup_count: dupCount,
        min_ts: minTs,
        max_ts: maxTs,
        min_ts_iso: DateTime.fromSeconds(minTs, { zone: 'utc' }).toISO()!,
        max_ts_iso: DateTime.fromSeconds(maxTs, { zone: 'utc' }).toISO()!,
        status,
      });
    } catch (error) {
      // If we can't process a token+interval, mark it as UNSAFE
      results.push({
        token_address,
        chain,
        interval,
        expected_count: 0,
        actual_count: 0,
        gap_count: 0,
        dup_count: 0,
        min_ts: null,
        max_ts: null,
        min_ts_iso: null,
        max_ts_iso: null,
        status: 'UNSAFE',
      });
    }
  }

  return results;
}
