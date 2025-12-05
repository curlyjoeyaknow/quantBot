/**
 * ClickHouse Client Stub
 * ======================
 * Stub for ClickHouse integration (optional dependency)
 */

import { DateTime } from 'luxon';
import { Candle } from '../simulation/candles';

/**
 * Query candles from ClickHouse
 */
export async function queryCandles(
  mint: string,
  chain: string,
  startTime: DateTime,
  endTime: DateTime
): Promise<Candle[]> {
  // Stub - returns empty array
  // In production, this would query ClickHouse
  return [];
}

/**
 * Insert candles into ClickHouse
 */
export async function insertCandles(
  mint: string,
  chain: string,
  candles: Candle[],
  interval: string
): Promise<void> {
  // Stub - no-op
  // In production, this would insert into ClickHouse
}

