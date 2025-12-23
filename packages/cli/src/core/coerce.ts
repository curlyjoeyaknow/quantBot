/**
 * Value Coercion Helpers
 *
 * These functions coerce values (JSON/numbers/arrays) but NEVER rename keys.
 * Use these in defineCommand's coerce() function.
 */

import { ValidationError } from '@quantbot/utils';

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

/**
 * Coerce a value to JSON-parsed object/array
 * Accepts:
 * - JSON string: '{"key":"value"}' or '[1,2,3]'
 * - Already parsed object/array
 * - undefined/null returns undefined
 */
export function coerceJson<T>(v: unknown, name: string): T | undefined {
  if (v === null || v === undefined) return undefined;
  if (!isString(v)) return v as T; // already parsed
  try {
    return JSON.parse(v) as T;
  } catch (e) {
    const preview = v.length > 80 ? `${v.substring(0, 80)}...` : v;
    throw new ValidationError(
      `Invalid JSON for ${name}: ${e instanceof Error ? e.message : String(e)}`,
      {
        name,
        input: preview,
        error: e instanceof Error ? e.message : String(e),
      }
    );
  }
}

/**
 * Coerce a value to a number
 * Accepts:
 * - Number: returns as-is
 * - String number: '123' -> 123
 * - undefined/null returns undefined
 */
export function coerceNumber(v: unknown, name: string): number | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number') return v;
  if (isString(v) && v.trim() !== '') {
    const n = Number(v);
    if (!Number.isFinite(n))
      throw new ValidationError(`Invalid number for ${name}`, { name, value: v });
    return n;
  }
  throw new ValidationError(`Invalid number for ${name}`, { name, value: v });
}

/**
 * Coerce a value to a number array
 * Accepts:
 * - JSON string: "[1,2,3]"
 * - Comma-separated string: "1,2,3"
 * - Already array: [1,2,3]
 * - undefined/null returns undefined
 */
export function coerceNumberArray(v: unknown, name: string): number[] | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    // Already an array - validate all elements are numbers
    return v.map((x) => {
      const num = coerceNumber(x, name);
      if (num === undefined)
        throw new ValidationError(`Invalid number in array for ${name}`, { name, value: x });
      return num;
    });
  }
  if (isString(v)) {
    const trimmed = v.trim();
    if (trimmed.startsWith('[')) {
      // JSON array string
      const parsed = coerceJson<number[]>(v, name);
      if (parsed === undefined)
        throw new ValidationError(`Invalid JSON array for ${name}`, { name, value: v });
      return parsed;
    }
    // Comma-separated string
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const num = coerceNumber(s, name);
        if (num === undefined)
          throw new ValidationError(`Invalid number in array for ${name}`, { name, value: s });
        return num;
      });
  }
  throw new ValidationError(`Invalid array for ${name}`, { name, value: v });
}

/**
 * Coerce a value to a string array
 * Accepts:
 * - JSON string: '["a","b","c"]'
 * - Comma-separated string: "a,b,c"
 * - Already array: ["a","b","c"]
 * - undefined/null returns undefined
 */
export function coerceStringArray(v: unknown, name: string): string[] | undefined {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    // Already an array - convert all elements to strings
    return v.map((x) => String(x));
  }
  if (isString(v)) {
    const trimmed = v.trim();
    if (trimmed.startsWith('[')) {
      // JSON array string
      const parsed = coerceJson<string[]>(v, name);
      if (parsed === undefined)
        throw new ValidationError(`Invalid JSON array for ${name}`, { name, value: v });
      return parsed;
    }
    // Comma-separated string
    return trimmed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  throw new ValidationError(`Invalid array for ${name}`, { name, value: v });
}

/**
 * Coerce a value to a boolean
 * Accepts:
 * - Boolean: returns as-is
 * - String: 'true'/'false'/'1'/'0'/'yes'/'no'/'on'/'off' (case-insensitive)
 * - Number: 1 -> true, 0 -> false
 * - undefined/null returns undefined
 */
export function coerceBoolean(v: unknown, name: string): boolean | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (isString(v)) {
    const lower = v.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') return false;
    throw new ValidationError(`Invalid boolean for ${name}`, { name, value: v });
  }
  throw new ValidationError(`Invalid boolean for ${name}`, { name, value: v });
}
