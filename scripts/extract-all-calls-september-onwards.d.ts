#!/usr/bin/env ts-node
/**
 * Extract All Calls from September Onwards
 *
 * Uses the unified chat extraction engine and OHLCV engine to:
 * 1. Process all message files from September 2025 onwards
 * 2. Extract tokens and metadata using the chat extraction engine
 * 3. Deduplicate tokens (same mint + chain)
 * 4. Fetch 5m OHLCV candles end-to-end for each unique token
 * 5. Report progress and results
 */
import 'dotenv/config';
//# sourceMappingURL=extract-all-calls-september-onwards.d.ts.map