#!/usr/bin/env ts-node
/**
 * Backfill MCAP and Metadata for Tokens in Database
 *
 * Uses intelligent fallback chain:
 * 1. Pump.fun/bonk detection (instant)
 * 2. Birdeye API (accurate)
 * 3. Message extraction (from stored alert text)
 * 4. Infer from current data
 *
 * Updates:
 * - entry_mcap field
 * - token metadata (symbol, name, decimals, etc.)
 */
/**
 * Main backfill process
 */
declare function backfillMcapAndMetadata(): Promise<void>;
export { backfillMcapAndMetadata };
//# sourceMappingURL=backfill-mcap-and-metadata.d.ts.map