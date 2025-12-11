#!/usr/bin/env ts-node
"use strict";
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
const fs = __importStar(require("fs"));
const candles_1 = require("../../src/simulation/candles");
const clickhouse_client_1 = require("../../src/storage/clickhouse-client");
const birdeye_client_1 = require("../../src/api/birdeye-client");
const logger_1 = require("../../src/utils/logger");
const TEST_MODE = process.env.TEST_MODE === 'true';
const TEST_TOKEN_COUNT = 2;
const DELAY_MS = 2000; // 2 seconds between tokens
const MIN_PERIODS = 52;
// Try multiple database paths for alerts
const ALERT_DB_PATHS = [
    path.join(process.cwd(), 'data', 'caller_alerts.db'),
    path.join(process.cwd(), 'caller_alerts.db'),
    path.join(process.cwd(), 'simulations.db'),
];
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Get unique tokens from alerts tables (tries multiple databases)
 *
 * NOTE: Token addresses are stored in lowercase in the database, but Solana addresses
 * are case-sensitive. If API calls fail, it may be due to incorrect case.
 * The addresses should be stored with their original case in the database.
 */
async function getTokensFromAlerts(chain = 'solana') {
    // Try each database path until we find one with data
    for (const dbPath of ALERT_DB_PATHS) {
        try {
            const tokens = await queryAlertsFromDatabase(dbPath, chain);
            if (tokens.length > 0) {
                logger_1.logger.info(`Found ${tokens.length} tokens in ${dbPath}`);
                // Warn if addresses appear to be lowercase (may cause API failures)
                const sampleToken = tokens[0];
                if (sampleToken && sampleToken.mint === sampleToken.mint.toLowerCase() && !sampleToken.mint.startsWith('0x')) {
                    logger_1.logger.warn('⚠️  Token addresses appear to be lowercase in database. Solana addresses are case-sensitive - API calls may fail if case is incorrect.');
                }
                return tokens;
            }
        }
        catch (error) {
            logger_1.logger.debug(`Failed to query ${dbPath}: ${error.message}`);
            continue;
        }
    }
    return [];
}
/**
 * Query alerts from a specific database file
 */
async function queryAlertsFromDatabase(dbPath, chain) {
    return new Promise((resolve, reject) => {
        // Check if file exists
        if (!fs.existsSync(dbPath)) {
            return resolve([]);
        }
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                return resolve([]); // Silently skip if can't open
            }
        });
        // Try caller_alerts table first (most common)
        const callerAlertsQuery = `
      SELECT 
        token_address as mint,
        chain,
        MIN(alert_timestamp) as alert_timestamp,
        MAX(token_symbol) as token_symbol
      FROM caller_alerts
      WHERE chain = ?
      GROUP BY token_address, chain
      ORDER BY alert_timestamp ASC
    `;
        db.all(callerAlertsQuery, [chain], (err, rows) => {
            if (!err && rows && rows.length > 0) {
                db.close();
                const tokens = rows.map(row => {
                    // Parse DATETIME string to Unix timestamp
                    let timestamp;
                    if (typeof row.alert_timestamp === 'string') {
                        const dt = luxon_1.DateTime.fromISO(row.alert_timestamp);
                        timestamp = dt.isValid ? Math.floor(dt.toSeconds()) : 0;
                    }
                    else {
                        timestamp = row.alert_timestamp || 0;
                    }
                    return {
                        mint: row.mint,
                        chain: row.chain || chain,
                        callTimestamp: timestamp,
                        tokenSymbol: row.token_symbol || undefined,
                    };
                });
                return resolve(tokens);
            }
            // Try ca_calls table as fallback
            const caCallsQuery = `
        SELECT 
          mint,
          chain,
          MIN(call_timestamp) as call_timestamp,
          MAX(token_name) as token_name,
          MAX(token_symbol) as token_symbol
        FROM ca_calls
        WHERE chain = ?
        GROUP BY mint, chain
        ORDER BY call_timestamp ASC
      `;
            db.all(caCallsQuery, [chain], (err2, rows2) => {
                db.close();
                if (err2 || !rows2 || rows2.length === 0) {
                    return resolve([]);
                }
                const tokens = rows2.map(row => ({
                    mint: row.mint,
                    chain: row.chain || chain,
                    callTimestamp: row.call_timestamp || 0,
                    tokenName: row.token_name || undefined,
                    tokenSymbol: row.token_symbol || undefined,
                }));
                resolve(tokens);
            });
        });
    });
}
async function ensureClickHouse() {
    try {
        await (0, clickhouse_client_1.initClickHouse)();
        logger_1.logger.info('ClickHouse initialized');
    }
    catch (error) {
        logger_1.logger.error('Failed to initialize ClickHouse', error);
        throw error;
    }
}
/**
 * Store candles immediately to ClickHouse with error handling
 */
async function storeCandlesImmediately(mint, chain, candles, interval) {
    if (candles.length === 0) {
        return true; // Nothing to store
    }
    try {
        await (0, clickhouse_client_1.insertCandles)(mint, chain, candles, interval);
        logger_1.logger.debug('Stored candles immediately', {
            mint: mint.substring(0, 20),
            chain,
            interval,
            count: candles.length,
        });
        return true;
    }
    catch (error) {
        logger_1.logger.error('Failed to store candles', error, {
            mint: mint.substring(0, 20),
            chain,
            interval,
            count: candles.length,
        });
        return false;
    }
}
/**
 * Fetch and store candles for a specific interval
 */
async function fetchAndStoreInterval(mint, chain, interval, startUnix, endUnix, threeMonthsAgo) {
    // Skip 15s if outside 3-month window
    if (interval === '15s' && threeMonthsAgo && startUnix < threeMonthsAgo) {
        logger_1.logger.debug('Skipping 15s fetch (outside 3-month window)', {
            mint: mint.substring(0, 20),
            start: new Date(startUnix * 1000).toISOString(),
        });
        return 0;
    }
    try {
        logger_1.logger.debug('Fetching candles', {
            mint: mint.substring(0, 20),
            interval,
            start: new Date(startUnix * 1000).toISOString(),
            end: new Date(endUnix * 1000).toISOString(),
        });
        const { fetchBirdeyeCandlesDirect } = await Promise.resolve().then(() => __importStar(require('../../src/simulation/candles')));
        const candles = await fetchBirdeyeCandlesDirect(mint, interval, startUnix, endUnix, chain);
        if (candles.length === 0) {
            // This could mean:
            // 1. Token doesn't exist on Birdeye (400/404) - possibly due to case sensitivity
            // 2. No data for this time range
            // 3. Token was delisted/never had enough volume
            // 4. Address case is incorrect (Solana addresses are case-sensitive)
            logger_1.logger.debug('No candles returned from Birdeye', {
                mint: mint.substring(0, 20),
                interval,
                start: new Date(startUnix * 1000).toISOString(),
                end: new Date(endUnix * 1000).toISOString(),
                note: 'Token may not exist, have no data, or address case may be incorrect (Solana addresses are case-sensitive)',
            });
            return 0;
        }
        // Store immediately
        const stored = await storeCandlesImmediately(mint, chain, candles, interval);
        if (!stored) {
            logger_1.logger.error('Failed to store candles', { mint: mint.substring(0, 20), interval, count: candles.length });
            return 0;
        }
        return candles.length;
    }
    catch (error) {
        logger_1.logger.error('Failed to fetch interval', error, {
            mint: mint.substring(0, 20),
            interval,
            start: new Date(startUnix * 1000).toISOString(),
            end: new Date(endUnix * 1000).toISOString(),
            errorMessage: error.message,
        });
        return 0;
    }
}
/**
 * Process a single token with optimized multi-timeframe fetching
 * Fetches and stores each interval separately for immediate persistence
 */
async function processToken(mint, chain, alertTime, stats) {
    const tokenDisplay = mint.substring(0, 20);
    logger_1.logger.info('Processing token', { mint: tokenDisplay, chain });
    try {
        const alertUnix = Math.floor(alertTime.toSeconds());
        const endUnix = Math.floor(luxon_1.DateTime.utc().toSeconds());
        const threeMonthsAgo = alertUnix - (90 * 24 * 60 * 60);
        let totalCandles = 0;
        let candles15s = 0;
        let candles1m = 0;
        let candles5m = 0;
        // Step 1: Fetch and store 1m candles (52 hours back + forward to 5000)
        const fiftyTwoHoursAgo = alertUnix - (52 * 60 * 60);
        const oneMStart = fiftyTwoHoursAgo;
        const oneMEnd = Math.min(oneMStart + (5000 * 60), endUnix);
        console.log(`  📊 Fetching 1m candles...`);
        console.log(`    Alert time: ${alertTime.toISO()}`);
        console.log(`    Range: ${new Date(oneMStart * 1000).toISOString()} to ${new Date(oneMEnd * 1000).toISOString()}`);
        candles1m = await fetchAndStoreInterval(mint, chain, '1m', oneMStart, oneMEnd);
        totalCandles += candles1m;
        if (candles1m > 0) {
            console.log(`    ✅ Stored ${candles1m} 1m candles`);
        }
        else {
            console.log(`    ⚠️  No 1m candles found`);
        }
        // Step 2: Fetch and store 15s candles (52×15s back + forward to 5000)
        const fiftyTwoPeriods15s = 52 * 15; // 780 seconds = 13 minutes
        const fifteenSStart = alertUnix - fiftyTwoPeriods15s;
        const fifteenSEnd = Math.min(fifteenSStart + (5000 * 15), endUnix);
        console.log(`  📊 Fetching 15s candles...`);
        candles15s = await fetchAndStoreInterval(mint, chain, '15s', fifteenSStart, fifteenSEnd, threeMonthsAgo);
        totalCandles += candles15s;
        if (candles15s > 0) {
            console.log(`    ✅ Stored ${candles15s} 15s candles`);
        }
        else {
            console.log(`    ⏭️  Skipped 15s (outside 3-month window or no data)`);
        }
        // Step 3: Fetch and store 5m candles (52×5m back + forward in 17-day chunks)
        const fiftyTwoPeriods5m = 52 * (5 * 60); // 15,600 seconds = 4.33 hours
        const fiveMStart = alertUnix - fiftyTwoPeriods5m;
        console.log(`  📊 Fetching 5m candles...`);
        let current5mFrom = fiveMStart;
        let fiveMChunks = 0;
        while (current5mFrom < endUnix) {
            const chunk5mTo = Math.min(current5mFrom + (17 * 24 * 60 * 60), endUnix); // 17 days max
            const chunkCandles = await fetchAndStoreInterval(mint, chain, '5m', current5mFrom, chunk5mTo);
            if (chunkCandles === 0) {
                break; // No more data
            }
            candles5m += chunkCandles;
            totalCandles += chunkCandles;
            fiveMChunks++;
            current5mFrom = chunk5mTo;
            // Small delay between chunks
            if (current5mFrom < endUnix) {
                await sleep(100);
            }
        }
        if (candles5m > 0) {
            console.log(`    ✅ Stored ${candles5m} 5m candles (${fiveMChunks} chunks)`);
        }
        else {
            console.log(`    ⚠️  No 5m candles found`);
        }
        if (totalCandles === 0) {
            logger_1.logger.warn('No candles fetched for token (may not exist on Birdeye or have no historical data)', {
                mint: tokenDisplay,
                chain,
                alertTime: alertTime.toISO(),
            });
            stats.skipped++;
            return false; // Don't count as failed - token just doesn't have data
        }
        // Step 4: Derive and store 1H candles
        const lookbackHours = 52;
        const endTime = luxon_1.DateTime.utc();
        const startTime = endTime.minus({ hours: lookbackHours });
        // Check if we already have enough 1H candles
        const existing1H = await (0, clickhouse_client_1.queryCandles)(mint, chain, startTime, endTime, '1H');
        if (existing1H.length < MIN_PERIODS) {
            // Use 5m or 1m as base for aggregation
            let baseCandles = await (0, clickhouse_client_1.queryCandles)(mint, chain, startTime, endTime, '5m');
            if (baseCandles.length < MIN_PERIODS) {
                baseCandles = await (0, clickhouse_client_1.queryCandles)(mint, chain, startTime, endTime, '1m');
            }
            if (baseCandles.length >= MIN_PERIODS) {
                console.log(`  📊 Deriving 1H candles from ${baseCandles.length} base candles...`);
                const candles1H = (0, candles_1.aggregateCandles)(baseCandles, '1H');
                if (candles1H.length > 0) {
                    await storeCandlesImmediately(mint, chain, candles1H, '1H');
                    console.log(`    ✅ Stored ${candles1H.length} 1H candles`);
                }
            }
        }
        else {
            console.log(`  ⏭️  Skipped 1H derivation (already have ${existing1H.length} candles)`);
        }
        stats.successful++;
        logger_1.logger.info('Successfully processed token', {
            mint: tokenDisplay,
            chain,
            totalCandles,
            candles15s,
            candles1m,
            candles5m,
        });
        return true;
    }
    catch (error) {
        logger_1.logger.error('Failed to process token', error, {
            mint: tokenDisplay,
            chain,
        });
        stats.failed++;
        return false;
    }
}
async function main() {
    console.log(`\n${'='.repeat(80)}`);
    console.log('🚀 FETCHING OPTIMIZED MULTI‑TIMEFRAME CANDLES FOR ALL TOKENS');
    console.log(`${'='.repeat(80)}\n`);
    if (TEST_MODE) {
        console.log('🧪 TEST MODE: Processing only first 2 tokens\n');
    }
    // Initialize services
    await ensureClickHouse();
    console.log('✅ ClickHouse initialized\n');
    // Get tokens from alerts (ca_calls table)
    const tokens = await getTokensFromAlerts('solana');
    if (tokens.length === 0) {
        console.log('⚠️  No tokens found in alerts database (ca_calls table). Exiting.');
        return;
    }
    const tokensToProcess = TEST_MODE ? tokens.slice(0, TEST_TOKEN_COUNT) : tokens;
    console.log(`📂 Found ${tokens.length} unique tokens in alerts database`);
    console.log(`📊 Processing ${tokensToProcess.length} tokens${TEST_MODE ? ' (TEST MODE)' : ''}\n`);
    const stats = {
        total: tokensToProcess.length,
        processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        creditsUsed: 0,
    };
    // Process tokens sequentially (one at a time) to ensure immediate storage
    for (let i = 0; i < tokensToProcess.length; i++) {
        const token = tokensToProcess[i];
        const progress = `[${i + 1}/${tokensToProcess.length}]`;
        console.log(`\n${progress} Processing: ${token.mint.substring(0, 30)}...`);
        if (token.tokenSymbol) {
            console.log(`    Token: ${token.tokenSymbol}${token.tokenName ? ` (${token.tokenName})` : ''}`);
        }
        // Use the alert timestamp from the database
        const alertTime = luxon_1.DateTime.fromSeconds(token.callTimestamp);
        const success = await processToken(token.mint, token.chain, alertTime, stats);
        stats.processed++;
        // Get current credit usage
        const creditStats = birdeye_client_1.birdeyeClient.getCreditUsageStats();
        stats.creditsUsed = creditStats.creditsUsed;
        if (success) {
            console.log(`  ✅ Success (Credits: ${creditStats.creditsUsed.toLocaleString()}/${creditStats.totalCredits.toLocaleString()})`);
        }
        else {
            console.log(`  ❌ Failed (Credits: ${creditStats.creditsUsed.toLocaleString()}/${creditStats.totalCredits.toLocaleString()})`);
        }
        // Delay between tokens (except for last one)
        if (i < tokensToProcess.length - 1) {
            await sleep(DELAY_MS);
        }
    }
    // Final summary
    const creditStats = birdeye_client_1.birdeyeClient.getCreditUsageStats();
    console.log(`\n${'='.repeat(80)}`);
    console.log('📊 FINAL SUMMARY');
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Total tokens: ${stats.total}`);
    console.log(`✅ Successful: ${stats.successful}`);
    console.log(`❌ Failed: ${stats.failed}`);
    console.log(`⏭️  Skipped: ${stats.skipped}`);
    console.log(`\n💰 Credit Usage:`);
    console.log(`   Used: ${creditStats.creditsUsed.toLocaleString()} credits`);
    console.log(`   Remaining: ${creditStats.creditsRemaining.toLocaleString()} credits`);
    console.log(`   Percentage: ${creditStats.percentage.toFixed(2)}%`);
    console.log(`\n✅ Done.\n`);
}
if (require.main === module) {
    main().catch((error) => {
        console.error('Fatal error in multi‑timeframe candle fetch script:', error);
        logger_1.logger.error('Fatal error', error);
        process.exit(1);
    });
}
//# sourceMappingURL=fetch-multi-timeframe-candles-for-all-tokens.js.map