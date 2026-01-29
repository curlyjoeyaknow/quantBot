/**
 * ClickHouse Query Builder for OHLCV Data
 *
 * Builds ClickHouse queries for fetching OHLCV candle data.
 * Supports multiple intervals and chain-specific tables.
 */

export interface OhlcvQueryParams {
  tokenAddress: string;
  chain: string;
  interval: string;
  dateRange: { from: string; to: string };
}

/**
 * Build ClickHouse query for OHLCV data
 *
 * @param params - Query parameters
 * @returns SQL query string
 */
export function buildOhlcvQuery(params: OhlcvQueryParams): string {
  const { tokenAddress, chain, interval, dateRange } = params;

  // Determine table name based on interval
  const tableName = getTableName(interval);

  // Build query
  const query = `
SELECT 
  timestamp,
  token_address,
  open,
  high,
  low,
  close,
  volume
FROM ${tableName}
WHERE token_address = '${tokenAddress}'
  AND timestamp >= toDateTime64('${dateRange.from}', 3)
  AND timestamp <= toDateTime64('${dateRange.to}', 3)
ORDER BY timestamp ASC
`.trim();

  return query;
}

/**
 * Get ClickHouse table name for interval
 *
 * @param interval - Time interval (e.g., '1m', '5m', '15m', '1h')
 * @returns Table name
 */
function getTableName(interval: string): string {
  // Map interval to table name
  const tableMap: Record<string, string> = {
    '1m': 'ohlcv_1m',
    '5m': 'ohlcv_5m',
    '15m': 'ohlcv_15m',
    '1h': 'ohlcv_1h',
  };

  const tableName = tableMap[interval];
  if (!tableName) {
    throw new Error(`Unsupported interval: ${interval}`);
  }

  return tableName;
}

/**
 * Validate query parameters
 *
 * @param params - Query parameters
 * @throws Error if parameters are invalid
 */
export function validateQueryParams(params: OhlcvQueryParams): void {
  if (!params.tokenAddress || params.tokenAddress.length === 0) {
    throw new Error('Token address is required');
  }

  if (!params.chain || params.chain.length === 0) {
    throw new Error('Chain is required');
  }

  if (!params.interval || params.interval.length === 0) {
    throw new Error('Interval is required');
  }

  if (!params.dateRange.from || !params.dateRange.to) {
    throw new Error('Date range (from/to) is required');
  }

  // Validate interval is supported
  const supportedIntervals = ['1m', '5m', '15m', '1h'];
  if (!supportedIntervals.includes(params.interval)) {
    throw new Error(
      `Unsupported interval: ${params.interval}. Supported: ${supportedIntervals.join(', ')}`
    );
  }

  // Validate date range
  const fromDate = new Date(params.dateRange.from);
  const toDate = new Date(params.dateRange.to);

  if (isNaN(fromDate.getTime())) {
    throw new Error(`Invalid 'from' date: ${params.dateRange.from}`);
  }

  if (isNaN(toDate.getTime())) {
    throw new Error(`Invalid 'to' date: ${params.dateRange.to}`);
  }

  if (fromDate >= toDate) {
    throw new Error("'from' date must be before 'to' date");
  }
}

