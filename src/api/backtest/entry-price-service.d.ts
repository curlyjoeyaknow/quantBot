/**
 * Entry Price Determination Service
 *
 * Determines entry price based on alert, time, or manual input.
 */
import { DateTime } from 'luxon';
export type EntryType = 'alert' | 'time' | 'manual';
export interface EntryPriceResult {
    entryPrice: number;
    entryTimestamp: number;
    entryType: EntryType;
    source?: string;
}
/**
 * Determine entry price based on type
 */
export declare function determineEntryPrice(mint: string, chain: string, entryTime: DateTime, entryType: EntryType, manualPrice?: number): Promise<EntryPriceResult>;
//# sourceMappingURL=entry-price-service.d.ts.map