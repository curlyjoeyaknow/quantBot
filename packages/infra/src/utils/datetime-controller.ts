/**
 * DateTimeController - Centralized UTC-only datetime handling
 *
 * ALL datetime operations in the codebase MUST go through this module.
 * This prevents timezone bugs like using local time instead of UTC.
 *
 * RULES:
 * 1. NEVER use new Date() without immediately converting to UTC
 * 2. NEVER use Date.now() for display - use DateTimeController.now()
 * 3. ALL timestamps in the system are milliseconds since Unix epoch (UTC)
 * 4. ALL ISO strings MUST end with 'Z' (UTC indicator)
 * 5. Use Luxon DateTime for manipulation, but always via this controller
 *
 * Usage:
 * ```typescript
 * import { dt } from '@quantbot/infra/utils';
 *
 * // Get current time
 * const now = dt.now();
 *
 * // Convert timestamp (milliseconds) to DateTime
 * const dtObj = dt.fromTimestampMs(1714521600000);
 *
 * // Convert DateTime to ISO string
 * const isoStr = dt.toISO(dtObj);  // "2024-05-01T00:00:00.000Z"
 *
 * // Parse ISO string
 * const dtObj = dt.fromISO("2024-05-01T00:00:00Z");
 *
 * // Convert DateTime to timestamp (milliseconds)
 * const tsMs = dt.toTimestampMs(dtObj);
 * ```
 */

import { DateTime } from 'luxon';

/**
 * Centralized datetime controller enforcing UTC everywhere.
 *
 * This class provides a single source of truth for all datetime operations,
 * preventing timezone bugs by always working in UTC.
 */
export class DateTimeController {
  /**
   * Get current time in UTC.
   *
   * @returns DateTime in UTC
   */
  now(): DateTime {
    return DateTime.utc();
  }

  /**
   * Get current timestamp in milliseconds.
   *
   * @returns Unix timestamp in milliseconds
   */
  nowMs(): number {
    return Date.now();
  }

  /**
   * Convert Unix timestamp (seconds) to UTC DateTime.
   *
   * @param timestampSeconds Unix timestamp in seconds
   * @returns DateTime in UTC
   */
  fromTimestampS(timestampSeconds: number): DateTime {
    return DateTime.fromSeconds(timestampSeconds, { zone: 'utc' });
  }

  /**
   * Convert Unix timestamp (milliseconds) to UTC DateTime.
   *
   * This is the preferred method since QuantBot uses milliseconds internally.
   *
   * @param timestampMs Unix timestamp in milliseconds
   * @returns DateTime in UTC
   */
  fromTimestampMs(timestampMs: number): DateTime {
    return DateTime.fromMillis(timestampMs, { zone: 'utc' });
  }

  /**
   * Convert DateTime to Unix timestamp (seconds).
   *
   * @param dt DateTime object
   * @returns Unix timestamp in seconds
   */
  toTimestampS(dt: DateTime): number {
    return Math.floor(dt.toSeconds());
  }

  /**
   * Convert DateTime to Unix timestamp (milliseconds).
   *
   * This is the preferred method since QuantBot uses milliseconds internally.
   *
   * @param dt DateTime object
   * @returns Unix timestamp in milliseconds
   */
  toTimestampMs(dt: DateTime): number {
    return dt.toMillis();
  }

  /**
   * Convert DateTime to ISO 8601 UTC string.
   *
   * Always returns format ending with 'Z'.
   *
   * @param dt DateTime object
   * @returns ISO 8601 string with Z suffix
   */
  toISO(dt: DateTime): string {
    return dt.toUTC().toISO() ?? '';
  }

  /**
   * Convert DateTime to ISO 8601 UTC string without milliseconds.
   *
   * @param dt DateTime object
   * @returns ISO 8601 string with Z suffix, no milliseconds
   */
  toISONoMs(dt: DateTime): string {
    return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
  }

  /**
   * Parse ISO 8601 string to UTC DateTime.
   *
   * Accepts:
   * - "2024-05-01T00:00:00Z"
   * - "2024-05-01T00:00:00.123Z"
   * - "2024-05-01T00:00:00+00:00"
   * - "2024-05-01" (assumes midnight UTC)
   *
   * @param isoString ISO 8601 formatted string
   * @returns DateTime in UTC
   */
  fromISO(isoString: string): DateTime {
    if (!isoString) {
      throw new Error('Empty ISO string');
    }

    // Parse with explicit UTC zone
    const dt = DateTime.fromISO(isoString, { zone: 'utc' });

    if (!dt.isValid) {
      throw new Error(`Invalid ISO string: ${isoString} - ${dt.invalidReason}`);
    }

    return dt.toUTC();
  }

  /**
   * Convert DateTime to ClickHouse-compatible format.
   *
   * ClickHouse prefers: "YYYY-MM-DD HH:mm:ss"
   *
   * @param dt DateTime object
   * @returns ClickHouse-compatible datetime string
   */
  toClickHouseFormat(dt: DateTime): string {
    return dt.toUTC().toFormat('yyyy-MM-dd HH:mm:ss');
  }

  /**
   * Parse date string (YYYY-MM-DD) to UTC DateTime at midnight.
   *
   * @param dateString Date string in YYYY-MM-DD format
   * @returns DateTime in UTC at midnight
   */
  fromDateString(dateString: string): DateTime {
    const dt = DateTime.fromISO(dateString, { zone: 'utc' });
    if (!dt.isValid) {
      throw new Error(`Invalid date string: ${dateString}`);
    }
    return dt.startOf('day');
  }

  /**
   * Check if DateTime is valid.
   *
   * @param dt DateTime object
   * @returns true if valid
   */
  isValid(dt: DateTime): boolean {
    return dt.isValid;
  }

  /**
   * Create DateTime from JavaScript Date (converts to UTC).
   *
   * @param date JavaScript Date object
   * @returns DateTime in UTC
   */
  fromJSDate(date: Date): DateTime {
    return DateTime.fromJSDate(date, { zone: 'utc' });
  }

  /**
   * Convert DateTime to JavaScript Date.
   *
   * @param dt DateTime object
   * @returns JavaScript Date object
   */
  toJSDate(dt: DateTime): Date {
    return dt.toJSDate();
  }
}

/**
 * Singleton instance for convenient imports.
 *
 * Usage:
 * ```typescript
 * import { dt } from '@quantbot/infra/utils';
 * const now = dt.now();
 * ```
 */
export const dt = new DateTimeController();

/**
 * Type guard to check if a value is a valid timestamp in milliseconds.
 * Valid timestamps are between 1970 and 2100.
 */
export function isValidTimestampMs(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  // Between 1970 and 2100
  return value >= 0 && value <= 4102444800000;
}

/**
 * Type guard to check if a value is a valid timestamp in seconds.
 * Valid timestamps are between 1970 and 2100.
 */
export function isValidTimestampS(value: unknown): value is number {
  if (typeof value !== 'number') return false;
  if (!Number.isFinite(value)) return false;
  // Between 1970 and 2100
  return value >= 0 && value <= 4102444800;
}

/**
 * Assert that a timestamp is in milliseconds (not seconds).
 * Throws if the timestamp appears to be in seconds.
 */
export function assertTimestampMs(value: number, context?: string): void {
  if (value < 1e12) {
    throw new Error(
      `Timestamp appears to be in seconds, not milliseconds: ${value}` +
        (context ? ` (context: ${context})` : '') +
        '. Use dt.fromTimestampS() for seconds or multiply by 1000.'
    );
  }
}
