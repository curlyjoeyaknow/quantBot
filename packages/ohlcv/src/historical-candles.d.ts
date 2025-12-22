import type { Candle } from '@quantbot/core';
/**
 * Fetch a monitoring-friendly slice of historical candles.
 * Uses 5m coverage back ~17 days (Birdeye 5000 candle limit) and preserves the
 * full, unmodified mint for all API/storage calls. Logging truncates for display only.
 */
export declare function fetchHistoricalCandlesForMonitoring(
  mint: string,
  chain?: string,
  alertTime?: Date
): Promise<Candle[]>;
//# sourceMappingURL=historical-candles.d.ts.map
