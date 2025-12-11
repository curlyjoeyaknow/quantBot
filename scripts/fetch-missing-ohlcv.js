#!/usr/bin/env tsx
"use strict";
/**
 * Fetch missing OHLCV data for alerts
 * - Fetches 52 periods BEFORE alert (for Ichimoku)
 * - Fetches up to 5000 candles total
 * - Stores in ClickHouse
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
const client_1 = require("@clickhouse/client");
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
const BIRDEYE_BASE_URL = 'https://public-api.birdeye.so';
const pgPool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'quantbot',
    password: process.env.POSTGRES_PASSWORD || 'quantbot',
    database: process.env.POSTGRES_DB || 'quantbot',
});
const clickhouse = (0, client_1.createClient)({
    url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
    database: process.env.CLICKHOUSE_DB || 'quantbot',
});
async function fetchBirdeyeCandles(tokenAddress, startTime, endTime, interval = '5m') {
    const url = `${BIRDEYE_BASE_URL}/defi/ohlcv?address=${tokenAddress}&type=${interval}&time_from=${Math.floor(startTime.getTime() / 1000)}&time_to=${Math.floor(endTime.getTime() / 1000)}`;
    try {
        const response = await fetch(url, {
            headers: {
                'X-API-KEY': BIRDEYE_API_KEY,
                'x-chain': 'solana',
            },
        });
        if (!response.ok) {
            if (response.status === 404 || response.status === 400) {
                return []; // Token doesn't exist or no data
            }
            throw new Error(`Birdeye API error: ${response.status}`);
        }
        const data = await response.json();
        if (!data.data?.items || data.data.items.length === 0) {
            return [];
        }
        return data.data.items.map((item) => ({
            timestamp: new Date(item.unixTime * 1000),
            open: item.o,
            high: item.h,
            low: item.l,
            close: item.c,
            volume: item.v,
        }));
    }
    catch (error) {
        console.error(`Error fetching candles for ${tokenAddress}:`, error);
        return [];
    }
}
async function getExistingTokens() {
    const result = await clickhouse.query({
        query: 'SELECT DISTINCT token_address FROM ohlcv_candles',
        format: 'JSONEachRow',
    });
    const data = await result.json();
    return new Set(data.map(row => row.token_address.toLowerCase()));
}
async function insertCandles(tokenAddress, chain, candles) {
    if (candles.length === 0)
        return;
    const rows = candles.map(c => ({
        token_address: tokenAddress, // Store FULL address
        chain: chain,
        timestamp: c.timestamp.toISOString().replace('T', ' ').substring(0, 19),
        interval: '5m',
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
    }));
    await clickhouse.insert({
        table: 'ohlcv_candles',
        values: rows,
        format: 'JSONEachRow',
    });
}
async function main() {
    if (!BIRDEYE_API_KEY) {
        console.error('❌ BIRDEYE_API_KEY not set');
        process.exit(1);
    }
    console.log('🔄 Fetching missing OHLCV data...\n');
    // Get tokens with alerts in last 30 days that have prices
    const alertsResult = await pgPool.query(`
    SELECT 
      t.address as token_address,
      t.symbol,
      t.chain,
      MIN(a.alert_timestamp) as first_alert,
      COUNT(*) as alert_count
    FROM tokens t
    JOIN alerts a ON a.token_id = t.id
    WHERE a.alert_price IS NOT NULL
    AND a.alert_price > 0
    AND t.chain = 'solana'
    AND a.alert_timestamp > '2025-01-01'
    GROUP BY t.address, t.symbol, t.chain
    ORDER BY first_alert DESC
  `);
    const alerts = alertsResult.rows.map(row => ({
        token_address: row.token_address,
        symbol: row.symbol,
        chain: row.chain,
        first_alert: new Date(row.first_alert),
        alert_count: parseInt(row.alert_count),
    }));
    console.log(`📊 Found ${alerts.length} tokens with alerts\n`);
    // Get existing tokens in ClickHouse (check both full and short addresses)
    const existingTokens = await getExistingTokens();
    console.log(`📦 Existing tokens in ClickHouse: ${existingTokens.size}\n`);
    let fetched = 0;
    let skipped = 0;
    let failed = 0;
    let totalCandles = 0;
    for (let i = 0; i < alerts.length; i++) {
        const alert = alerts[i];
        const shortAddr = alert.token_address.substring(0, 8).toLowerCase();
        const fullAddr = alert.token_address.toLowerCase();
        // Check if we already have data for this token
        if (existingTokens.has(shortAddr) || existingTokens.has(fullAddr)) {
            console.log(`[${i + 1}/${alerts.length}] ${alert.symbol} - Already have data, skipping`);
            skipped++;
            continue;
        }
        // Calculate time range: 52 periods (260 min for 5m) BEFORE alert, then 5000 candles forward
        const lookbackMinutes = 52 * 5; // 260 minutes = 4.33 hours
        const forwardMinutes = 5000 * 5; // 25000 minutes = ~17.36 days
        const startTime = new Date(alert.first_alert.getTime() - lookbackMinutes * 60 * 1000);
        const endTime = new Date(startTime.getTime() + forwardMinutes * 60 * 1000);
        // Cap endTime at now
        const now = new Date();
        const actualEndTime = endTime > now ? now : endTime;
        console.log(`[${i + 1}/${alerts.length}] ${alert.symbol} (${alert.alert_count} alerts)`);
        console.log(`    Address: ${alert.token_address}`);
        console.log(`    First alert: ${alert.first_alert.toISOString()}`);
        console.log(`    Fetching: ${startTime.toISOString()} → ${actualEndTime.toISOString()}`);
        const candles = await fetchBirdeyeCandles(alert.token_address, startTime, actualEndTime, '5m');
        if (candles.length > 0) {
            await insertCandles(alert.token_address, alert.chain, candles);
            console.log(`    ✅ Fetched ${candles.length} candles`);
            fetched++;
            totalCandles += candles.length;
            existingTokens.add(fullAddr); // Mark as fetched
        }
        else {
            console.log(`    ⚠️ No data available`);
            failed++;
        }
        // Rate limit: 100ms between requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('\n' + '='.repeat(60));
    console.log('📊 Summary:');
    console.log(`   ✅ Fetched: ${fetched} tokens (${totalCandles} candles)`);
    console.log(`   ⏭️ Skipped: ${skipped} tokens (already had data)`);
    console.log(`   ❌ Failed: ${failed} tokens (no data available)`);
    await pgPool.end();
    await clickhouse.close();
}
main().catch(console.error);
//# sourceMappingURL=fetch-missing-ohlcv.js.map