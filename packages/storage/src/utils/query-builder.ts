/**
 * Query Builder Utilities
 * =======================
 *
 * Consolidated SQL query building utilities to eliminate duplication
 * and prevent SQL injection.
 *
 * @module @quantbot/storage/utils
 */

import { DateTime } from 'luxon';

/**
 * Escape a string for use in SQL queries
 * Prevents SQL injection by escaping single quotes
 *
 * @param value - String value to escape
 * @returns Escaped string safe for SQL interpolation
 */
export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Build WHERE clause for token address matching
 *
 * Handles:
 * - Exact match (case-sensitive)
 * - Case-insensitive match
 * - LIKE pattern matching (prefix and suffix)
 *
 * CRITICAL: Preserves full address and exact case matching
 *
 * @param tokenAddress - Full mint address (case-preserved)
 * @param columnName - Column name to match against (default: 'token_address')
 * @returns SQL WHERE clause fragment
 */
export function buildTokenAddressWhereClause(
  tokenAddress: string,
  columnName: string = 'token_address'
): string {
  const escapedToken = escapeSqlString(tokenAddress);
  const tokenPattern = `${tokenAddress}%`;
  const tokenPatternSuffix = `%${tokenAddress}`;
  const escapedTokenPattern = escapeSqlString(tokenPattern);
  const escapedTokenPatternSuffix = escapeSqlString(tokenPatternSuffix);

  return `(${columnName} = '${escapedToken}'
           OR lower(${columnName}) = lower('${escapedToken}')
           OR ${columnName} LIKE '${escapedTokenPattern}'
           OR lower(${columnName}) LIKE lower('${escapedTokenPattern}')
           OR ${columnName} LIKE '${escapedTokenPatternSuffix}'
           OR lower(${columnName}) LIKE lower('${escapedTokenPatternSuffix}'))`;
}

/**
 * Build WHERE clause for date range queries
 *
 * @param from - Start date (DateTime)
 * @param to - End date (DateTime)
 * @param columnName - Column name to match against (default: 'timestamp')
 * @returns SQL WHERE clause fragment
 */
export function buildDateRangeWhereClause(
  from: DateTime,
  to: DateTime,
  columnName: string = 'timestamp'
): string {
  const startUnix = Math.floor(from.toSeconds());
  const endUnix = Math.floor(to.toSeconds());

  return `${columnName} >= toDateTime(${startUnix})
      AND ${columnName} <= toDateTime(${endUnix})`;
}

/**
 * Build WHERE clause for date range queries (Unix timestamp format)
 *
 * @param fromUnix - Start Unix timestamp (seconds)
 * @param toUnix - End Unix timestamp (seconds)
 * @param columnName - Column name to match against (default: 'timestamp')
 * @returns SQL WHERE clause fragment
 */
export function buildDateRangeWhereClauseUnix(
  fromUnix: number,
  toUnix: number,
  columnName: string = 'timestamp'
): string {
  return `${columnName} >= toDateTime(${fromUnix})
      AND ${columnName} <= toDateTime(${toUnix})`;
}

/**
 * Build WHERE clause for chain matching
 *
 * @param chain - Chain identifier
 * @param columnName - Column name to match against (default: 'chain')
 * @returns SQL WHERE clause fragment
 */
export function buildChainWhereClause(chain: string, columnName: string = 'chain'): string {
  const escapedChain = escapeSqlString(chain);
  return `${columnName} = '${escapedChain}'`;
}

/**
 * Build WHERE clause for interval matching
 *
 * @param intervalSeconds - Interval in seconds
 * @param columnName - Column name to match against (default: 'interval_seconds')
 * @returns SQL WHERE clause fragment
 */
export function buildIntervalWhereClause(
  intervalSeconds: number,
  columnName: string = 'interval_seconds'
): string {
  return `${columnName} = ${intervalSeconds}`;
}

/**
 * Build WHERE clause for interval string matching
 *
 * Handles reserved keyword 'interval' by escaping with backticks
 *
 * @param interval - Interval string (e.g., '5m', '1h')
 * @param columnName - Column name to match against (default: 'interval')
 * @returns SQL WHERE clause fragment
 */
export function buildIntervalStringWhereClause(
  interval: string,
  columnName: string = 'interval'
): string {
  const escapedInterval = escapeSqlString(interval);
  // Escape column name with backticks if it's a reserved keyword
  const escapedColumnName = columnName === 'interval' ? '`interval`' : columnName;
  return `${escapedColumnName} = '${escapedInterval}'`;
}

/**
 * Build WHERE clause for IN operator with string values
 *
 * Escapes all values to prevent SQL injection
 *
 * @param values - Array of string values
 * @param columnName - Column name to match against
 * @returns SQL WHERE clause fragment (e.g., "column IN ('value1', 'value2')")
 */
export function buildInWhereClause(values: string[], columnName: string): string {
  if (values.length === 0) {
    return '1 = 0'; // Always false, matches nothing
  }
  const escapedValues = values.map((v) => `'${escapeSqlString(v)}'`).join(',');
  return `${columnName} IN (${escapedValues})`;
}
