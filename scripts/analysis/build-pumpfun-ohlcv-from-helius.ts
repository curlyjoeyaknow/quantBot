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
import { heliusRestClient } from '../../src/api/helius-client';
import type { Candle } from '../../src/simulation/candles';
import { aggregateCandles } from '../../src/simulation/candles';

type Tick = {
  timestamp: number; // seconds
  price: number; // SOL per token
  volume: number; // tokens (human units)
};

async function fetchAllTransactionsForAddress(address: string): Promise<any[]> {
  const all: any[] = [];
  let before: string | undefined;

  // Helius returns newest-first; we paginate backwards until no more txs.
  // Limit is capped at 100 per Helius API.
  const pageSize = 100;

  for (;;) {
    const batch = await heliusRestClient.getTransactionsForAddress(address, {
      limit: pageSize,
      before,
    });
    if (!batch.length) break;

    all.push(...batch);
    const last = batch[batch.length - 1];
    if (!last?.signature || batch.length < pageSize) {
      break;
    }
    before = last.signature as string;
  }

  // Oldest -> newest
  return all.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
}

/**
 * Derive trade ticks for a specific mint from a Helius tx.
 *
 * For each user account:
 *  - deltaToken = net change in that mint (human units)
 *  - deltaSol   = nativeBalanceChange (lamports)
 * If both non-zero and opposite sign, we treat that as a trade and derive price.
 */
function deriveTicksFromTx(tx: any, mint: string): Tick[] {
  const ticks: Tick[] = [];
  const timestamp = typeof tx.timestamp === 'number' ? tx.timestamp : Math.floor(Date.now() / 1000);

  const accountNativeDelta = new Map<string, number>();
  const tokenDelta = new Map<string, number>();

  // Native SOL deltas from accountData.nativeBalanceChange (lamports)
  const accountData = Array.isArray(tx.accountData) ? tx.accountData : [];
  for (const acc of accountData) {
    const account = acc.account as string | undefined;
    const delta = typeof acc.nativeBalanceChange === 'number' ? acc.nativeBalanceChange : 0;
    if (!account || !delta) continue;
    accountNativeDelta.set(account, (accountNativeDelta.get(account) ?? 0) + delta);
  }

  // Token deltas for our mint from tokenBalanceChanges
  const tbc = Array.isArray(tx.accountData)
    ? accountData.flatMap((acc) => acc.tokenBalanceChanges ?? [])
    : [];

  for (const change of tbc) {
    if (change.mint !== mint) continue;
    const userAccount = change.userAccount as string | undefined;
    if (!userAccount) continue;

    const raw = change.rawTokenAmount?.tokenAmount ?? '0';
    const decimals = change.rawTokenAmount?.decimals ?? 0;
    const rawNum = Number(raw);
    if (!rawNum) continue;

    const deltaTokens = rawNum / 10 ** decimals;
    tokenDelta.set(userAccount, (tokenDelta.get(userAccount) ?? 0) + deltaTokens);
  }

  for (const [account, deltaTokens] of tokenDelta.entries()) {
    const deltaLamports = accountNativeDelta.get(account) ?? 0;
    if (!deltaTokens || !deltaLamports) continue;

    // User buys: deltaTokens > 0, deltaLamports < 0
    // User sells: deltaTokens < 0, deltaLamports > 0
    if (deltaTokens > 0 && deltaLamports >= 0) continue;
    if (deltaTokens < 0 && deltaLamports <= 0) continue;

    const tokens = Math.abs(deltaTokens);
    const sol = Math.abs(deltaLamports) / 1_000_000_000; // lamports -> SOL
    if (!tokens || !sol) continue;

    const price = sol / tokens;
    if (!Number.isFinite(price) || price <= 0) continue;

    ticks.push({
      timestamp,
      price,
      volume: tokens,
    });
  }

  return ticks;
}

function buildOneMinuteCandles(ticks: Tick[]): Candle[] {
  if (!ticks.length) return [];

  type Acc = {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  };

  const byBucket = new Map<number, Acc>();

  const sortedTicks = [...ticks].sort((a, b) => a.timestamp - b.timestamp);

  for (const tick of sortedTicks) {
    const bucketStart = Math.floor(tick.timestamp / 60) * 60;
    const existing = byBucket.get(bucketStart);
    if (!existing) {
      byBucket.set(bucketStart, {
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: tick.volume,
      });
    } else {
      existing.close = tick.price;
      if (tick.price > existing.high) existing.high = tick.price;
      if (tick.price < existing.low) existing.low = tick.price;
      existing.volume += tick.volume;
    }
  }

  return Array.from(byBucket.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, acc]) => ({
      timestamp,
      open: acc.open,
      high: acc.high,
      low: acc.low,
      close: acc.close,
      volume: acc.volume,
    }));
}

async function main(): Promise<void> {
  const mint =
    process.argv[2] ??
    '6euErXNV8wD3FcJtvcmhe13Sd8jPuRJ9v9X7DLgHp777'; // default example mint

  if (!process.env.HELIUS_API_KEY) {
    // eslint-disable-next-line no-console
    console.error('HELIUS_API_KEY is not set; cannot call Helius');
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log(`Building Pump.fun OHLCV for mint ${mint} using Helius tx history...\n`);

  const txs = await fetchAllTransactionsForAddress(mint);
  // eslint-disable-next-line no-console
  console.log(`Fetched ${txs.length} transactions involving ${mint.substring(0, 8)}...`);

  const allTicks: Tick[] = [];
  for (const tx of txs) {
    const ticks = deriveTicksFromTx(tx, mint);
    allTicks.push(...ticks);
  }

  // eslint-disable-next-line no-console
  console.log(`Derived ${allTicks.length} trade ticks for this mint.`);

  const candles1m = buildOneMinuteCandles(allTicks);
  const candles5m = aggregateCandles(candles1m, '5m');

  // Summaries
  const first1m = candles1m[0];
  const last1m = candles1m[candles1m.length - 1];
  const first5m = candles5m[0];
  const last5m = candles5m[candles5m.length - 1];

  // eslint-disable-next-line no-console
  console.log('\n1m candles:', candles1m.length);
  // eslint-disable-next-line no-console
  console.log('First 1m candle:', first1m);
  // eslint-disable-next-line no-console
  console.log('Last 1m candle:', last1m);

  // eslint-disable-next-line no-console
  console.log('\n5m candles:', candles5m.length);
  // eslint-disable-next-line no-console
  console.log('First 5m candle:', first5m);
  // eslint-disable-next-line no-console
  console.log('Last 5m candle:', last5m);
}

if (require.main === module) {
  // eslint-disable-next-line no-console
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Error building Pump.fun OHLCV from Helius:', error);
    process.exit(1);
  });
}


