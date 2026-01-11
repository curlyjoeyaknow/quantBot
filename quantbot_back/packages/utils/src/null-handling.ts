/**
 * Null Handling Utilities
 * =======================
 *
 * Type-safe utilities for handling null and undefined values.
 * These utilities help prevent null reference errors and improve code clarity.
 *
 * All functions are pure (no side effects) and work with TypeScript's strict null checks.
 */

/**
 * Type guard: Check if value is not null or undefined
 */
export function isNotNull<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Type guard: Check if value is null or undefined
 */
export function isNullish<T>(value: T | null | undefined): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Type guard: Check if value is specifically null
 */
export function isNull(value: unknown): value is null {
  return value === null;
}

/**
 * Type guard: Check if value is specifically undefined
 */
export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

/**
 * Type guard: Check if value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Type guard: Check if value is a non-empty array
 */
export function isNonEmptyArray<T>(value: T[] | null | undefined): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Type guard: Check if value is a non-empty object (not array, not null)
 */
export function isNonEmptyObject<T extends Record<string, unknown>>(
  value: T | null | undefined
): value is T {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

/**
 * Get value or throw if null/undefined
 *
 * @throws {Error} If value is null or undefined
 */
export function assertNotNull<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message ?? 'Value is null or undefined');
  }
}

/**
 * Get value or return default
 */
export function orDefault<T>(value: T | null | undefined, defaultValue: T): T {
  return value ?? defaultValue;
}

/**
 * Get value or return undefined (explicit null handling)
 */
export function orUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined;
}

/**
 * Get value or return null (explicit null handling)
 */
export function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

/**
 * Safe property access with fallback
 *
 * @example
 * const price = safeGet(candle, 'close', 0);
 */
export function safeGet<T, K extends keyof T>(
  obj: T | null | undefined,
  key: K,
  defaultValue: T[K]
): T[K] {
  if (obj === null || obj === undefined) {
    return defaultValue;
  }
  const value = obj[key];
  return value ?? defaultValue;
}

/**
 * Safe nested property access
 *
 * @example
 * const symbol = safeNestedGet(call, ['token', 'symbol'], 'UNKNOWN');
 */
export function safeNestedGet<T>(obj: unknown, path: string[], defaultValue: T): T {
  if (obj === null || obj === undefined) {
    return defaultValue;
  }

  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return (current as T) ?? defaultValue;
}

/**
 * Filter out null/undefined values from array
 *
 * @example
 * const validPrices = filterNullish(prices); // number[] instead of (number | null | undefined)[]
 */
export function filterNullish<T>(values: Array<T | null | undefined>): T[] {
  return values.filter(isNotNull);
}

/**
 * Map over array, filtering out null/undefined results
 *
 * @example
 * const validPrices = mapAndFilterNullish(candles, c => c?.close); // number[]
 */
export function mapAndFilterNullish<T, U>(
  values: T[],
  mapper: (value: T) => U | null | undefined
): U[] {
  return values.map(mapper).filter(isNotNull);
}

/**
 * Get first non-null value from array
 */
export function firstNotNull<T>(values: Array<T | null | undefined>): T | undefined {
  return values.find(isNotNull);
}

/**
 * Get last non-null value from array
 */
export function lastNotNull<T>(values: Array<T | null | undefined>): T | undefined {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (isNotNull(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Require value to be non-null, throw with context if null
 *
 * @throws {Error} If value is null or undefined
 */
export function requireNotNull<T>(
  value: T | null | undefined,
  context?: Record<string, unknown>
): T {
  if (value === null || value === undefined) {
    const contextStr = context ? ` Context: ${JSON.stringify(context)}` : '';
    throw new Error(`Required value is null or undefined.${contextStr}`);
  }
  return value;
}

/**
 * Safe array access with bounds checking
 */
export function safeArrayGet<T>(array: T[] | null | undefined, index: number, defaultValue: T): T {
  if (!Array.isArray(array) || index < 0 || index >= array.length) {
    return defaultValue;
  }
  const value = array[index];
  return value ?? defaultValue;
}

/**
 * Check if all values in array are non-null
 */
export function allNotNull<T>(values: Array<T | null | undefined>): values is T[] {
  return values.every(isNotNull);
}

/**
 * Check if any value in array is non-null
 */
export function anyNotNull<T>(values: Array<T | null | undefined>): boolean {
  return values.some(isNotNull);
}

/**
 * Coalesce: return first non-null value
 *
 * @example
 * const price = coalesce(candle.close, candle.open, 0);
 */
export function coalesce<T>(...values: Array<T | null | undefined>): T | undefined {
  return values.find(isNotNull);
}

/**
 * Coalesce with default: return first non-null value or default
 *
 * @example
 * const price = coalesceWithDefault(candle.close, candle.open, 0);
 */
export function coalesceWithDefault<T>(defaultValue: T, ...values: Array<T | null | undefined>): T {
  return values.find(isNotNull) ?? defaultValue;
}
