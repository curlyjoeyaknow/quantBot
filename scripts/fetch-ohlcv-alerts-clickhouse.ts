#!/usr/bin/env tsx
/**
 * Fetch OHLCV candles for tokens that have alerts and prices, and store in ClickHouse.
 * - Uses full, case-preserved token addresses (NO lowercasing/truncation).
 * - 52 periods lookback (5m candles => 260 minutes) before first alert.
 * - Fetch up to 5000 candles forward (Birdeye limit).
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { createClient } from '@clickhouse/client';

interface AlertToken {
  address: string;
  chain: string;
  symbol: string | null;
  firstAlert: Date;
  alertCount: number;
}

interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE_URL = 'https://public-api.birdeye.so';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || 'quantbot',
  database: process.env.POSTGRES_DB || 'quantbot',
});

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  database: process.env.CLICKHOUSE_DB || 'quantbot',
});

function mapChain(chain: string): string {
  const lc = chain.toLowerCase();
  if (lc === 'solana') return 'solana';
  if (lc === 'bsc') return 'bsc';
  if (lc === 'eth' || lc === 'ethereum') return 'eth';
  if (lc === 'base') return 'base';
  if (lc === 'arbitrum' || lc === 'arb') return 'arbitrum';
  return 'solana';
}

async function fetchBirdeyeCandles(
  tokenAddress: string,
  chain: string,
  startTime: Date,
  endTime: Date,
  interval: '5m' | '1m' = '5m',
): Promise<Candle[]> {
  const params = new URLSearchParams({
    address: tokenAddress,
    type: interval,
    time_from: Math.floor(startTime.getTime() / 1000).toString(),
    time_to: Math.floor(endTime.getTime() / 1000).toString(),
    // currency, ui_amount_mode, mode are optional here
  });

  const resp = await fetch(`${BIRDEYE_BASE_URL}/defi/v3/ohlcv?${params.toString()}`, {
    headers: {
      'X-API-KEY': BIRDEYE_API_KEY!,
      'x-chain': mapChain(chain),
      'Accept': 'application/json',
    },
  });

  if (!resp.ok) {
    if (resp.status === 400 || resp.status === 404) {
      return [];
    }
    throw new Error(`Birdeye error ${resp.status}`);
  }

  const json = await resp.json();
  const items = json?.data?.items;
  if (!Array.isArray(items) || items.length === 0) return [];

  return items.map((item: any) => ({
    timestamp: new Date((item.unixTime ?? item.unix_time) * 1000),
    open: Number(item.o) || 0,
    high: Number(item.h) || 0,
    low: Number(item.l) || 0,
    close: Number(item.c) || 0,
    volume: Number(item.v) || 0,
  }));
}

async function insertCandles(
  tokenAddress: string,
  chain: string,
  interval: string,
  candles: Candle[],
): Promise<void> {
  if (!candles.length) return;

  await clickhouse.insert({
    table: 'ohlcv_candles',
    values: candles.map(c => ({
      token_address: tokenAddress, // full, case-preserved
      chain,
      timestamp: c.timestamp.toISOString().replace('T', ' ').substring(0, 19),
      interval,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    })),
    format: 'JSONEachRow',
  });
}

async function getAlertTokens(): Promise<AlertToken[]> {
  const res = await pgPool.query(`
    SELECT 
      t.address,
      t.chain,
      t.symbol,
      MIN(a.alert_timestamp) AS first_alert,
      COUNT(*) AS alert_count
    FROM tokens t
    JOIN alerts a ON a.token_id = t.id
    WHERE a.alert_price IS NOT NULL
      AND a.alert_price > 0
      AND a.alert_timestamp > '2025-01-01'
    GROUP BY t.address, t.chain, t.symbol
    ORDER BY COUNT(*) DESC
    LIMIT 500
  `);

  return res.rows.map(r => ({
    address: r.address as string,
    chain: r.chain as string,
    symbol: r.symbol as string | null,
    firstAlert: new Date(r.first_alert),
    alertCount: Number(r.alert_count),
  }));
}

async function main() {
  if (!BIRDEYE_API_KEY) {
    console.error('❌ BIRDEYE_API_KEY not set');
    process.exit(1);
  }

  console.log(`🔑 Birdeye key prefix: ${BIRDEYE_API_KEY.slice(0, 6)}****`);
  console.log('🔄 Fetching OHLCV for alert tokens (ClickHouse)...\n');

  const tokens = await getAlertTokens();
  console.log(`📊 Tokens to fetch: ${tokens.length}\n`);

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let totalCandles = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const symbol = (t.symbol || 'UNKNOWN').slice(0, 16);
    // 5m interval: 52 periods = 260 minutes before alert
    const lookbackMinutes = 52 * 5;
    const forwardMinutes = 5000 * 5; // ~17.36 days
    const start = new Date(t.firstAlert.getTime() - lookbackMinutes * 60 * 1000);
    const end = new Date(Math.min(Date.now(), start.getTime() + forwardMinutes * 60 * 1000));

    process.stdout.write(`[${i + 1}/${tokens.length}] ${symbol} (${t.alertCount})... `);

    try {
      const candles = await fetchBirdeyeCandles(t.address, t.chain, start, end, '5m');
      if (candles.length === 0) {
        console.log('⚠️  No data');
        failed++;
        continue;
      }

      await insertCandles(t.address, t.chain, '5m', candles);
      console.log(`✅ ${candles.length} candles`);
      fetched++;
      totalCandles += candles.length;
      // gentle rate limit
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      console.log(`❌ ${err?.message || err}`);
      failed++;
      if (err?.message?.includes('429')) {
        console.log('⏳ Rate limited, waiting 60s...');
        await new Promise(r => setTimeout(r, 60000));
      }
    }
  }

  console.log('\n📊 Summary');
  console.log(`   ✅ Success: ${fetched}`);
  console.log(`   ⚠️ No data: ${failed}`);
  console.log(`   ⏭️ Skipped: ${skipped}`);
  console.log(`   📈 Candles inserted: ${totalCandles.toLocaleString()}`);

  await pgPool.end();
  await clickhouse.close();
}

main().catch(err => {
  console.error('Fatal error', err);
  process.exit(1);
});


