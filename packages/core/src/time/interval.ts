/**
 * Interval conversion utilities
 *
 * Provides canonical conversion between interval string labels and numeric seconds.
 * This ensures consistent interval handling across the codebase.
 */

export type IntervalSeconds = 1 | 60 | 300;
export type IntervalLabel = '1s' | '1m' | '5m';

/**
 * Convert interval string label to numeric seconds
 */
export function intervalToSeconds(label: string): IntervalSeconds {
  switch (label) {
    case '1s':
      return 1;
    case '1m':
      return 60;
    case '5m':
      return 300;
    default:
      throw new Error(`Unknown interval label: ${label}`);
  }
}

/**
 * Convert numeric seconds to interval string label
 */
export function secondsToIntervalLabel(seconds: IntervalSeconds): IntervalLabel {
  switch (seconds) {
    case 1:
      return '1s';
    case 60:
      return '1m';
    case 300:
      return '5m';
  }
}
