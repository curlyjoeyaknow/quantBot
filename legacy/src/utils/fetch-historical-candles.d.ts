/**
 * Fetch Historical Candles Utility
 * =================================
 * Fetches historical candles for live monitoring initialization.
 * Uses 3 API calls: 1m, 5m, and 1h timeframes.
 */
import { Candle } from '../simulation/candles';
/**
 * Fetch historical candles for a token
 * Makes 3 API calls: 1m, 5m, and 1h
 * Returns 5m candles (used by monitoring service) with up to 5000 candles
 */
export declare function fetchHistoricalCandlesForMonitoring(tokenAddress: string, chain?: string, alertTime?: Date): Promise<Candle[]>;
//# sourceMappingURL=fetch-historical-candles.d.ts.map