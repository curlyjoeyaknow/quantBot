/**
 * Interval converter utility
 *
 * Converts interval strings to seconds for storage/query operations.
 */

/**
 * Convert interval string to seconds
 */
export function intervalToSeconds(interval: string): number {
  const map: Record<string, number> = {
    '1s': 1,
    '15s': 15,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1h': 3600,
    '4h': 14400,
    '1d': 86400,
  };
  return map[interval] || 60; // Default to 1m
}
