/**
 * Convert interval string to seconds
 * Supports: '1s', '15s', '1m', '5m', '15m', '1H', '4H', '1D'
 */
export function intervalToSeconds(interval: string): number {
  const normalized = interval.trim().toLowerCase();

  // Handle seconds
  if (normalized === '1s') return 1;
  if (normalized === '15s') return 15;

  // Handle minutes
  if (normalized === '1m') return 60;
  if (normalized === '5m') return 300;
  if (normalized === '15m') return 900;

  // Handle hours
  if (normalized === '1h' || normalized === '1H') return 3600;
  if (normalized === '4h' || normalized === '4H') return 14400;

  // Handle days
  if (normalized === '1d' || normalized === '1D') return 86400;

  // Try to parse as number of seconds
  const seconds = parseInt(normalized, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds;
  }

  throw new Error(`Unsupported interval format: ${interval}`);
}
