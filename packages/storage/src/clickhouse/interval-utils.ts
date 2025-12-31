/**
 * Interval conversion utilities for ClickHouse
 *
 * Converts interval strings (like '1m', '5m', '15s') to seconds (UInt32)
 */

/**
 * Convert interval string to seconds
 * Supports: '1s', '15s', '1m', '5m', '15m', '1h', '4h', '1d', '1H'
 */
export function intervalToSeconds(interval: string): number {
  const normalized = interval.toLowerCase();
  switch (normalized) {
    case '1s':
      return 1;
    case '15s':
      return 15;
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '1h':
    case '1H': // Handle both lowercase and uppercase (Birdeye uses '1H')
      return 3600;
    case '4h':
      return 14400;
    case '1d':
      return 86400;
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }
}
