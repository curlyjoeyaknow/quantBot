import { DateTime } from 'luxon';
import { fetchHybridCandles } from '@quantbot/data';
import type { Candle } from '@quantbot/core';
import { logger } from '@quantbot/utils';

/**
 * Fetch a monitoring-friendly slice of historical candles.
 * Uses 5m coverage back ~17 days (Birdeye 5000 candle limit) and preserves the
 * full, unmodified mint for all API/storage calls. Logging truncates for display only.
 */
export async function fetchHistoricalCandlesForMonitoring(
  mint: string,
  chain: string = 'solana',
  alertTime?: Date
): Promise<Candle[]> {
  const endTime = DateTime.utc();
  const startTime = endTime.minus({ days: 18 });

  try {
    // If an alert time is provided, extend backwards to ensure indicator warmup
    const alertDateTime = alertTime ? DateTime.fromJSDate(alertTime) : undefined;
    const candles = await fetchHybridCandles(mint, startTime, endTime, chain, alertDateTime);
    return candles.slice(-5000);
  } catch (error) {
    logger.warn('Failed to fetch historical candles for monitoring', {
      mint: mint.substring(0, 20),
      chain,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

