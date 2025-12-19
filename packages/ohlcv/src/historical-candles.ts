import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { getStorageEngine } from '@quantbot/storage';

/**
 * Fetch a monitoring-friendly slice of historical candles from ClickHouse (offline-only).
 *
 * NOTE: This function is OFFLINE-ONLY. It queries ClickHouse only.
 * For fetching candles from APIs, use @quantbot/jobs workflows.
 *
 * @param mint Token mint address
 * @param chain Blockchain name (defaults to 'solana')
 * @param alertTime Optional alert time (not used for query, kept for API compatibility)
 * @returns Array of candles (up to 5000) from ClickHouse
 */
export async function fetchHistoricalCandlesForMonitoring(
  mint: string,
  chain: string = 'solana',
  _alertTime?: Date // Kept for API compatibility, not used in offline-only implementation
): Promise<Candle[]> {
  const endTime = DateTime.utc();
  const startTime = endTime.minus({ days: 18 });

  try {
    const storageEngine = getStorageEngine();
    const candles = await storageEngine.getCandles(mint, chain, startTime, endTime, {
      interval: '5m',
    });

    // Limit to 5000 candles (monitoring-friendly slice)
    return candles.slice(-5000);
  } catch (error) {
    logger.warn('Failed to fetch historical candles for monitoring from ClickHouse', {
      mint: mint.substring(0, 20),
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
