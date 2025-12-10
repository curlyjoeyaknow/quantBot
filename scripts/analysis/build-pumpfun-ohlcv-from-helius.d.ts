#!/usr/bin/env ts-node
/**
 * Build 1m and 5m OHLCV from Helius transactions for a single Pump.fun mint.
 *
 * Assumptions (per user context):
 * - Trades are pure SOL <-> token on Pump.fun AMM (no USDC).
 * - Helius enriched transactions already parse Token-2022 / token program logs.
 * - We only care about a single mint, and it has not graduated yet.
 *
 * Approach:
 * 1. Fetch all transactions involving the mint address from Helius (newest -> oldest).
 * 2. For each tx, derive one or more "ticks" for that mint:
 *    - For each user account with non-zero deltaToken and deltaSOL:
 *      price = |ΔSOL| / |Δtoken|  (SOL per token), volume = |Δtoken|.
 * 3. Bucket ticks into 1m OHLCV candles.
 * 4. Aggregate those 1m candles into 5m using `aggregateCandles`.
 * 5. Print summary + sample candles.
 */
import 'dotenv/config';
//# sourceMappingURL=build-pumpfun-ohlcv-from-helius.d.ts.map