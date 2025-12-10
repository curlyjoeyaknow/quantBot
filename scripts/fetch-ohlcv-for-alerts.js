#!/usr/bin/env tsx
"use strict";
/**
 * Fetch OHLCV data for tokens that have alerts with prices
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
const client_1 = require("@clickhouse/client");
const luxon_1 = require("luxon");
const node_fetch_1 = __importDefault(require("node-fetch"));
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || '';
const BIRDEYE_BASE_URL = 'https://public-api.birdeye.so';
const pgPool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'quantbot',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DATABASE || 'quantbot',
});
const clickhouse = (0, client_1.createClient)({
    url: `http://${process.env.CLICKHOUSE_HOST || 'localhost'}:${process.env.CLICKHOUSE_PORT || 18123}`,
    database: 'quantbot',
});
async function fetchBirdeyeOHLCV(tokenAddress, startTime, endTime) {
    const startUnix = Math.floor(startTime.getTime() / 1000);
    const endUnix = Math.floor(endTime.getTime() / 1000);
    const url = `${BIRDEYE_BASE_URL}/defi/ohlcv?address=${tokenAddress}&type=1m&time_from=${startUnix}&time_to=${endUnix}`;
    const response = await (0, node_fetch_1.default)(url, {
        headers: {
            'X-API-KEY': BIRDEYE_API_KEY,
            'x-chain': 'solana',
        },
    });
    if (!response.ok) {
        throw new Error(`Birdeye API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data?.data?.items || [];
}
async function insertCandles(tokenAddress, chain, candles) {
    if (candles.length === 0)
        return 0;
    const rows = candles.map(c => ({
        token_address: tokenAddress.toLowerCase(),
        chain: chain.toLowerCase(),
        timestamp: luxon_1.DateTime.fromSeconds(c.unixTime).toFormat('yyyy-MM-dd HH:mm:ss'),
        interval: '1m',
        open: parseFloat(c.o) || 0,
        high: parseFloat(c.h) || 0,
        low: parseFloat(c.l) || 0,
        close: parseFloat(c.c) || 0,
        volume: parseFloat(c.v) || 0,
    }));
    await clickhouse.insert({
        table: 'ohlcv_candles',
        values: rows,
        format: 'JSONEachRow',
    });
    return rows.length;
}
async function main() {
    console.log('🔄 Fetching OHLCV data for tokens with alerts...\n');
    if (!BIRDEYE_API_KEY) {
        console.error('❌ BIRDEYE_API_KEY not set in .env');
        process.exit(1);
    }
    // Get tokens with alerts that have prices (Solana only for Birdeye)
    const result = await pgPool.query(`
    SELECT DISTINCT 
      t.address,
      t.symbol,
      t.chain,
      MIN(a.alert_timestamp) as first_alert,
      MAX(a.alert_timestamp) as last_alert,
      COUNT(*) as alert_count
    FROM tokens t
    JOIN alerts a ON a.token_id = t.id
    WHERE a.alert_price IS NOT NULL
    AND a.alert_price > 0
    AND t.chain = 'solana'
    AND a.alert_timestamp > '2025-01-01'
    GROUP BY t.address, t.symbol, t.chain
    HAVING COUNT(*) >= 3
    ORDER BY alert_count DESC
    LIMIT 50
  `);
    console.log(`📊 Found ${result.rows.length} tokens to fetch\n`);
    let successCount = 0;
    let totalCandles = 0;
    let failCount = 0;
    for (let i = 0; i < result.rows.length; i++) {
        const token = result.rows[i];
        const symbol = token.symbol || 'UNKNOWN';
        // Fetch up to 17 days (Birdeye limit) around the alerts
        const startTime = new Date(token.first_alert);
        startTime.setDate(startTime.getDate() - 1); // 1 day before first alert
        const endTime = new Date(token.last_alert);
        endTime.setDate(endTime.getDate() + 7); // 7 days after last alert
        // Enforce 17-day max limit
        const daysDiff = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > 17) {
            endTime.setTime(startTime.getTime() + (17 * 24 * 60 * 60 * 1000));
        }
        process.stdout.write(`[${i + 1}/${result.rows.length}] ${symbol.substring(0, 15)} (${token.alert_count} alerts)... `);
        try {
            const candles = await fetchBirdeyeOHLCV(token.address, startTime, endTime);
            if (candles.length === 0) {
                console.log('⚠️  No data');
                failCount++;
                continue;
            }
            const inserted = await insertCandles(token.address, token.chain, candles);
            console.log(`✅ ${inserted.toLocaleString()} candles`);
            successCount++;
            totalCandles += inserted;
            // Rate limit: Birdeye free tier is ~10 req/min
            await new Promise(resolve => setTimeout(resolve, 6500));
        }
        catch (error) {
            console.log(`❌ ${error.message.substring(0, 50)}`);
            failCount++;
            if (error.message.includes('429') || error.message.includes('rate limit')) {
                console.log('⏳ Rate limited, waiting 60s...');
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
    }
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Success: ${successCount} tokens`);
    console.log(`   ❌ Failed: ${failCount} tokens`);
    console.log(`   📈 Total candles: ${totalCandles.toLocaleString()}`);
    await pgPool.end();
    await clickhouse.close();
}
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=fetch-ohlcv-for-alerts.js.map