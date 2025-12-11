#!/usr/bin/env ts-node
"use strict";
/**
 * Fetch 5m Candles for All Tokens from November Onwards
 *
 * Fetches 5m OHLCV candles for all tokens that have alerts from November 2025 onwards.
 * Reports any tokens that return no candle data.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const luxon_1 = require("luxon");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const ohlcv_engine_1 = require("../src/services/ohlcv-engine");
const logger_1 = require("../src/utils/logger");
const NOV_1_2025 = luxon_1.DateTime.fromISO('2025-11-01T00:00:00Z');
const END_TIME = luxon_1.DateTime.utc();
const BATCH_SIZE = 10; // Process 10 tokens at a time to avoid rate limits
const DELAY_MS = 1000; // 1 second delay between batches
async function getAllTokensFromNovember() {
    return new Promise((resolve, reject) => {
        // Use caller_alerts.db (separate database for caller alerts)
        const dbPath = process.env.CALLER_DB_PATH || path.join(process.cwd(), 'caller_alerts.db');
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                reject(err);
                return;
            }
        });
        const query = `
      SELECT DISTINCT 
        token_address as tokenAddress,
        chain,
        MIN(alert_timestamp) as firstAlertTime
      FROM caller_alerts
      WHERE datetime(alert_timestamp) >= datetime(?)
        AND chain = 'solana'
      GROUP BY token_address, chain
      ORDER BY firstAlertTime ASC
    `;
        db.all(query, [NOV_1_2025.toISO()], (err, rows) => {
            db.close();
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}
async function fetchCandlesForToken(tokenAddress, chain, firstAlertTime, engine) {
    try {
        // Use the unified OHLCV engine - it handles caching, fetching, and ingestion
        const result = await engine.fetch(tokenAddress, NOV_1_2025, END_TIME, chain, {
            ensureIngestion: true,
            interval: '5m'
            // Not passing alertTime - just fetching 5m candles for the full period
        });
        if (result.candles.length === 0) {
            return {
                candleCount: 0,
                success: false,
                fromCache: false,
                ingestedToClickHouse: false,
                source: 'api',
                error: 'No candles returned'
            };
        }
        return {
            candleCount: result.candles.length,
            success: true,
            fromCache: result.fromCache,
            ingestedToClickHouse: result.ingestedToClickHouse,
            source: result.source
        };
    }
    catch (error) {
        return {
            candleCount: 0,
            success: false,
            fromCache: false,
            ingestedToClickHouse: false,
            source: 'api',
            error: error.message || String(error)
        };
    }
}
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🚀 FETCHING 5M CANDLES FOR ALL TOKENS FROM NOVEMBER ONWARDS');
    console.log(`${'='.repeat(80)}\n`);
    console.log(`📅 Date range: ${NOV_1_2025.toFormat('yyyy-MM-dd')} to ${END_TIME.toFormat('yyyy-MM-dd')}`);
    console.log(`⏱️  Interval: 5m candles`);
    console.log(`💾 Cache: Using unified OHLCV engine (CSV cache and ClickHouse)\n`);
    // Initialize the unified OHLCV engine
    const engine = (0, ohlcv_engine_1.getOHLCVEngine)();
    await engine.initialize();
    console.log('✅ OHLCV Engine initialized\n');
    try {
        // Get all tokens from November onwards
        console.log('📂 Loading tokens from database...');
        const tokens = await getAllTokensFromNovember();
        console.log(`✅ Found ${tokens.length} unique tokens\n`);
        if (tokens.length === 0) {
            console.log('⚠️  No tokens found. Exiting.');
            return;
        }
        const results = [];
        const noDataTokens = [];
        let processed = 0;
        console.log(`🔄 Processing ${tokens.length} tokens in batches of ${BATCH_SIZE}...\n`);
        for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
            const batch = tokens.slice(i, i + BATCH_SIZE);
            const batchNum = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(tokens.length / BATCH_SIZE);
            console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} tokens)`);
            const batchPromises = batch.map(async (token) => {
                const result = await fetchCandlesForToken(token.tokenAddress, token.chain, token.firstAlertTime, engine);
                const tokenResult = {
                    tokenAddress: token.tokenAddress,
                    chain: token.chain,
                    firstAlertTime: token.firstAlertTime,
                    candleCount: result.candleCount,
                    success: result.success,
                    fromCache: result.fromCache,
                    ingestedToClickHouse: result.ingestedToClickHouse,
                    source: result.source,
                    error: result.error
                };
                results.push(tokenResult);
                if (!result.success || result.candleCount === 0) {
                    noDataTokens.push(tokenResult);
                    console.log(`  ❌ ${token.tokenAddress.substring(0, 30)}... - ${result.error || 'No candles'}`);
                }
                else {
                    const sourceEmoji = result.source === 'clickhouse' ? '💾' : result.source === 'csv' ? '📦' : '🌐';
                    const cacheStatus = result.fromCache ? '(cached)' : '(fetched)';
                    const clickhouseStatus = result.ingestedToClickHouse ? '✅' : '⚠️';
                    console.log(`  ✅ ${token.tokenAddress.substring(0, 30)}... - ${result.candleCount} candles ${sourceEmoji} ${cacheStatus} ${clickhouseStatus}`);
                }
                processed++;
            });
            await Promise.all(batchPromises);
            // Delay between batches to avoid rate limits
            if (i + BATCH_SIZE < tokens.length) {
                await sleep(DELAY_MS);
            }
        }
        // Summary
        const successful = results.filter(r => r.success && r.candleCount > 0);
        const fromCache = successful.filter(r => r.fromCache).length;
        const fetchedFresh = successful.filter(r => !r.fromCache).length;
        const ingestedToClickHouse = successful.filter(r => r.ingestedToClickHouse).length;
        console.log(`\n${'='.repeat(80)}`);
        console.log('📊 SUMMARY');
        console.log(`${'='.repeat(80)}\n`);
        console.log(`Total tokens processed: ${results.length}`);
        console.log(`✅ Successfully fetched: ${successful.length}`);
        console.log(`   📦 From cache: ${fromCache}`);
        console.log(`   🌐 Fetched fresh: ${fetchedFresh}`);
        console.log(`   💾 Ingested to ClickHouse: ${ingestedToClickHouse}`);
        console.log(`❌ No data returned: ${noDataTokens.length}\n`);
        if (noDataTokens.length > 0) {
            console.log(`\n${'='.repeat(80)}`);
            console.log('⚠️  TOKENS WITH NO CANDLE DATA');
            console.log(`${'='.repeat(80)}\n`);
            for (const token of noDataTokens) {
                console.log(`Token: ${token.tokenAddress}`);
                console.log(`  Chain: ${token.chain}`);
                console.log(`  First Alert: ${token.firstAlertTime}`);
                console.log(`  Error: ${token.error || 'No candles returned'}`);
                console.log('');
            }
            // Save to file
            const outputFile = path.join(process.cwd(), 'data', 'exports', 'tokens-no-candles-nov-onwards.json');
            const fs = await Promise.resolve().then(() => __importStar(require('fs')));
            const outputDir = path.dirname(outputFile);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }
            fs.writeFileSync(outputFile, JSON.stringify(noDataTokens, null, 2));
            console.log(`\n💾 Saved results to: ${outputFile}`);
        }
        console.log(`\n✅ Done!\n`);
    }
    catch (error) {
        console.error('\n❌ Error:', error.message);
        logger_1.logger.error('Failed to fetch candles', error);
        process.exit(1);
    }
}
if (require.main === module) {
    main().catch(console.error);
}
//# sourceMappingURL=fetch-all-tokens-5m-candles-nov-onwards.js.map