#!/usr/bin/env ts-node
/**
 * Fetch Multi‑Timeframe Candles for All Tokens in Registry
 *
 * For every token in the SQLite `tokens` table:
 * - Fetch optimized multi-timeframe candles (1m, 15s, 5m) using the new strategy
 * - Store immediately after each successful fetch (no batching)
 * - Derive 1H candles by aggregating lower‑timeframe candles
 *
 * Features:
 * - Processes tokens sequentially (one at a time) to ensure data is stored immediately
 * - Test mode: Use TEST_MODE=true to process only first 2 tokens
 * - Progress tracking with resume capability
 * - Credit usage tracking
 * - Stores to ClickHouse immediately after each fetch
 */
import 'dotenv/config';
//# sourceMappingURL=fetch-multi-timeframe-candles-for-all-tokens.d.ts.map