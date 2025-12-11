"use strict";
/**
 * Score all tokens in unified calls table and analyze P&L for high-scoring tokens
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
exports.scoreAndAnalyzeCalls = scoreAndAnalyzeCalls;
exports.analyzePnLByScore = analyzePnLByScore;
const sqlite3_1 = require("sqlite3");
const util_1 = require("util");
const luxon_1 = require("luxon");
const dotenv_1 = require("dotenv");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const birdeye_client_1 = require("../../src/api/birdeye-client");
const logger_1 = require("../../src/utils/logger");
const analyze_brook_token_selection_1 = require("./analyze-brook-token-selection");
const create_unified_calls_table_1 = require("./create-unified-calls-table");
const clickhouse_client_1 = require("../../src/storage/clickhouse-client");
const cache_manager_1 = require("./cache-manager");
(0, dotenv_1.config)();
(0, dotenv_1.config)();
/**
 * Get all calls from unified database
 */
async function getAllCalls(limit) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.Database(create_unified_calls_table_1.UNIFIED_DB_PATH, (err) => {
            if (err) {
                logger_1.logger.error('Failed to open unified database', err);
                return reject(err);
            }
        });
        const all = (0, util_1.promisify)(db.all.bind(db));
        // Only get calls with valid timestamps (after 2020-01-01)
        const query = limit
            ? `SELECT * FROM unified_calls WHERE call_timestamp > 1577836800 AND call_timestamp < 2000000000 ORDER BY call_timestamp DESC LIMIT ?`
            : `SELECT * FROM unified_calls WHERE call_timestamp > 1577836800 AND call_timestamp < 2000000000 ORDER BY call_timestamp DESC`;
        const params = limit ? [limit] : [];
        all(query, params)
            .then((rows) => {
            db.close();
            const calls = rows.map(row => ({
                id: row.id,
                tokenAddress: row.token_address,
                tokenSymbol: row.token_symbol,
                chain: row.chain || 'solana',
                callTimestamp: row.call_timestamp,
                priceAtCall: row.price_at_call,
                volumeAtCall: row.volume_at_call,
                marketCapAtCall: row.market_cap_at_call,
                callerName: row.caller_name,
            }));
            resolve(calls);
        })
            .catch((err) => {
            db.close();
            reject(err);
        });
    });
}
/**
 * Extract features from a call (similar to analyze-brook-token-selection.ts)
 */
async function extractFeatures(call, candles) {
    const callUnix = call.callTimestamp;
    const callTime = luxon_1.DateTime.fromSeconds(callUnix);
    // Get price/volume at call time
    // Try to find candle closest to call time (within 5 min), or use first available candle
    let callCandle = candles.find(c => Math.abs(c.timestamp - callUnix) < 300); // Within 5 min
    if (!callCandle && candles.length > 0) {
        // If no candle within 5 min, use the closest one (could be after call time)
        callCandle = candles.reduce((closest, current) => {
            const closestDiff = Math.abs(closest.timestamp - callUnix);
            const currentDiff = Math.abs(current.timestamp - callUnix);
            return currentDiff < closestDiff ? current : closest;
        });
    }
    if (!callCandle || callCandle.price === 0) {
        logger_1.logger.debug('No valid candle at call time', {
            tokenAddress: call.tokenAddress.substring(0, 20),
            candlesCount: candles.length,
            callUnix,
        });
        return null;
    }
    const price = call.priceAtCall || callCandle.price;
    const volume = call.volumeAtCall || callCandle.volume;
    const marketCap = call.marketCapAtCall || 0;
    // Price changes before call (use whatever data is available)
    const candlesBefore = candles.filter(c => c.timestamp < callUnix);
    // Get prices at different time intervals before call (if available)
    const price15mAgo = candlesBefore
        .filter(c => callUnix - c.timestamp <= 900)
        .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
    const price1hAgo = candlesBefore
        .filter(c => callUnix - c.timestamp <= 3600)
        .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
    const price24hAgo = candlesBefore
        .filter(c => callUnix - c.timestamp <= 86400)
        .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
    // Calculate price changes (use 0 if no pre-call data available)
    const priceChange15m = price15mAgo && price15mAgo > 0 ? ((price - price15mAgo) / price15mAgo) * 100 : 0;
    const priceChange1h = price1hAgo && price1hAgo > 0 ? ((price - price1hAgo) / price1hAgo) * 100 : 0;
    const priceChange24h = price24hAgo && price24hAgo > 0 ? ((price - price24hAgo) / price24hAgo) * 100 : 0;
    // Volume analysis
    const volume1hAgo = candlesBefore
        .filter(c => callUnix - c.timestamp <= 3600 && callUnix - c.timestamp > 1800)
        .reduce((sum, c) => sum + c.volume, 0);
    const volume1hBefore = candlesBefore
        .filter(c => callUnix - c.timestamp <= 1800 && callUnix - c.timestamp > 0)
        .reduce((sum, c) => sum + c.volume, 0);
    const volumeChange1h = volume1hAgo > 0
        ? ((volume1hBefore - volume1hAgo) / volume1hAgo) * 100
        : 0;
    const avgVolume24h = candlesBefore
        .filter(c => callUnix - c.timestamp <= 86400)
        .reduce((sum, c) => sum + c.volume, 0) / Math.max(1, candlesBefore.filter(c => callUnix - c.timestamp <= 86400).length);
    // Volatility
    const priceChanges24h = candlesBefore
        .filter(c => callUnix - c.timestamp <= 86400)
        .map((c, i, arr) => {
        if (i === 0)
            return 0;
        const prev = arr[i - 1];
        return prev.price > 0 ? ((c.price - prev.price) / prev.price) * 100 : 0;
    })
        .filter(change => change !== 0);
    const avgChange = priceChanges24h.reduce((sum, c) => sum + c, 0) / Math.max(1, priceChanges24h.length);
    const variance = priceChanges24h.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / Math.max(1, priceChanges24h.length);
    const volatility24h = Math.sqrt(variance);
    // Timing features
    const hourOfDay = callTime.hour;
    const dayOfWeek = callTime.weekday % 7;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    // Market cap category
    let marketCapCategory;
    if (marketCap < 1000000) {
        marketCapCategory = 'micro';
    }
    else if (marketCap < 10000000) {
        marketCapCategory = 'small';
    }
    else if (marketCap < 100000000) {
        marketCapCategory = 'mid';
    }
    else {
        marketCapCategory = 'large';
    }
    return {
        price,
        volume,
        marketCap,
        priceChange15m,
        priceChange1h,
        priceChange24h,
        volumeChange1h,
        avgVolume24h,
        hourOfDay,
        dayOfWeek,
        isWeekend,
        volatility24h,
        marketCapCategory,
    };
}
/**
 * Fetch candles for analysis
 */
async function fetchCandlesForAnalysis(tokenAddress, callUnix, chain = 'solana') {
    // Request data from call time forward (tokens might not exist before creation)
    // Also try to get some data before call if available (for price action analysis)
    const startTime = luxon_1.DateTime.fromSeconds(callUnix - 3600); // 1 hour before (token might be new)
    const endTime = luxon_1.DateTime.fromSeconds(callUnix + 2592000); // 30 days after
    // Try ClickHouse first (much faster, no API limits)
    try {
        const clickhouseCandles = await (0, clickhouse_client_1.queryCandles)(tokenAddress, chain, startTime, endTime, '5m');
        if (clickhouseCandles && clickhouseCandles.length > 0) {
            logger_1.logger.info('✅ Using ClickHouse candles', {
                tokenAddress: tokenAddress.substring(0, 30),
                chain,
                count: clickhouseCandles.length,
                timeRange: `${new Date((callUnix - 3600) * 1000).toISOString()} to ${new Date((callUnix + 2592000) * 1000).toISOString()}`,
            });
            return clickhouseCandles.map(candle => ({
                timestamp: candle.timestamp,
                price: candle.close,
                volume: candle.volume,
            }));
        }
    }
    catch (error) {
        logger_1.logger.debug('ClickHouse query failed, falling back to API', {
            tokenAddress: tokenAddress.substring(0, 20),
            error: error.message,
        });
    }
    // Fall back to Birdeye API if not in ClickHouse
    // Check cache first to avoid wasting API credits
    const startUnix = startTime.toSeconds();
    const endUnix = endTime.toSeconds();
    const cached = (0, cache_manager_1.getCachedResponse)(tokenAddress, chain, startUnix, endUnix, '5m');
    if (cached !== null) {
        const cachedData = cached.data;
        if (cachedData && cachedData.items && Array.isArray(cachedData.items) && cachedData.items.length > 0) {
            logger_1.logger.info('✅ Using cached API response', {
                tokenAddress: tokenAddress.substring(0, 30),
                chain,
                count: cachedData.items.length,
            });
            return cachedData.items.map((item) => ({
                timestamp: item.unixTime,
                price: typeof item.close === 'string' ? parseFloat(item.close) : (item.close || 0),
                volume: typeof item.volume === 'string' ? parseFloat(item.volume) : (item.volume || 0),
            }));
        }
        else {
            // Cached "no data" response - but check if it's a recent cache (within 1 hour)
            // If it's old, retry the API call in case data is now available
            const cacheAge = Date.now() - cached.timestamp;
            const oneHour = 60 * 60 * 1000;
            if (cacheAge < oneHour) {
                logger_1.logger.debug('Using cached no-data response (recent)', {
                    tokenAddress: tokenAddress.substring(0, 20),
                    ageMinutes: Math.floor(cacheAge / 60000),
                });
                return [];
            }
            else {
                logger_1.logger.debug('Cached no-data response is old, retrying API', {
                    tokenAddress: tokenAddress.substring(0, 20),
                    ageHours: Math.floor(cacheAge / (60 * 60 * 1000)),
                });
                // Fall through to API call below
            }
        }
    }
    // Not in cache, fetch from API
    logger_1.logger.info('🌐 Fetching from Birdeye API', {
        tokenAddress: tokenAddress.substring(0, 30),
        chain,
        timeRange: `${new Date(startUnix * 1000).toISOString()} to ${new Date(endUnix * 1000).toISOString()}`,
    });
    try {
        const birdeyeData = await birdeye_client_1.birdeyeClient.fetchOHLCVData(tokenAddress, new Date(startUnix * 1000), new Date(endUnix * 1000), '5m', chain);
        if (!birdeyeData || !birdeyeData.items) {
            // Cache the "no data" response to avoid retrying
            (0, cache_manager_1.cacheNoDataResponse)(tokenAddress, chain, startUnix, endUnix, '5m');
            return [];
        }
        // Cache the successful response
        (0, cache_manager_1.cacheResponse)(tokenAddress, chain, startUnix, endUnix, '5m', birdeyeData);
        logger_1.logger.info('✅ Successfully fetched from Birdeye API', {
            tokenAddress: tokenAddress.substring(0, 30),
            chain,
            count: birdeyeData.items.length,
        });
        return birdeyeData.items.map(item => ({
            timestamp: item.unixTime,
            price: typeof item.close === 'string' ? parseFloat(item.close) : (item.close || 0),
            volume: typeof item.volume === 'string' ? parseFloat(item.volume) : (item.volume || 0),
        }));
    }
    catch (error) {
        // Cache the error (no data) to avoid retrying
        (0, cache_manager_1.cacheNoDataResponse)(tokenAddress, chain, startUnix, endUnix, '5m');
        logger_1.logger.warn('Failed to fetch candles from API', {
            tokenAddress: tokenAddress.substring(0, 20),
            error: error.message,
        });
        return [];
    }
}
/**
 * Calculate returns (MCAP-based)
 * Uses market cap multiples instead of just price multiples for better cross-token comparison
 */
function calculateReturns(callPrice, candles, callUnix, entryMcap // Optional: market cap at call time
) {
    const candlesAfter = candles.filter(c => c.timestamp > callUnix);
    const candles7d = candlesAfter.filter(c => c.timestamp <= callUnix + 604800);
    const candles30d = candlesAfter.filter(c => c.timestamp <= callUnix + 2592000);
    const maxPrice7d = candles7d.length > 0
        ? Math.max(...candles7d.map(c => c.price))
        : callPrice;
    const maxPrice30d = candles30d.length > 0
        ? Math.max(...candles30d.map(c => c.price))
        : callPrice;
    const priceAt7d = candles7d.length > 0
        ? candles7d.sort((a, b) => a.timestamp - b.timestamp)[candles7d.length - 1]?.price || callPrice
        : callPrice;
    const priceAt30d = candles30d.length > 0
        ? candles30d.sort((a, b) => a.timestamp - b.timestamp)[candles30d.length - 1]?.price || callPrice
        : callPrice;
    // Calculate price multiples (always available)
    const priceMultiple7d = maxPrice7d / callPrice;
    const priceMultiple30d = maxPrice30d / callPrice;
    const priceMultipleAt7d = priceAt7d / callPrice;
    const priceMultipleAt30d = priceAt30d / callPrice;
    // If entry MCAP is available, calculate MCAP values
    const result = {
        maxReturn7d: priceMultiple7d,
        maxReturn30d: priceMultiple30d,
        returnAt7d: priceMultipleAt7d,
        returnAt30d: priceMultipleAt30d,
    };
    if (entryMcap) {
        // Calculate peak MCAPs: peak_mcap = entry_mcap * (peak_price / entry_price)
        result.maxMcap7d = entryMcap * priceMultiple7d;
        result.maxMcap30d = entryMcap * priceMultiple30d;
        result.mcapAt7d = entryMcap * priceMultipleAt7d;
        result.mcapAt30d = entryMcap * priceMultipleAt30d;
    }
    return result;
}
function categorizePerformance(maxReturn30d) {
    if (maxReturn30d >= 10)
        return 'moon';
    if (maxReturn30d >= 3)
        return 'good';
    if (maxReturn30d >= 1.5)
        return 'decent';
    return 'poor';
}
/**
 * Score and analyze all calls
 */
async function scoreAndAnalyzeCalls(calls, scoreModel) {
    const scoredCalls = [];
    const batchSize = 5;
    let processed = 0;
    logger_1.logger.info('Scoring and analyzing calls', { total: calls.length });
    for (let i = 0; i < calls.length; i += batchSize) {
        const batch = calls.slice(i, i + batchSize);
        await Promise.all(batch.map(async (call) => {
            try {
                processed++;
                if (processed % 50 === 0) {
                    logger_1.logger.info('Progress', { processed, total: calls.length });
                }
                // Fetch candles
                logger_1.logger.debug('Fetching candles for token', {
                    tokenAddress: call.tokenAddress.substring(0, 30),
                    chain: call.chain,
                    callTimestamp: new Date(call.callTimestamp * 1000).toISOString(),
                    caller: call.callerName,
                });
                const candles = await fetchCandlesForAnalysis(call.tokenAddress, call.callTimestamp, call.chain);
                if (candles.length === 0) {
                    logger_1.logger.debug('No candles found, skipping', {
                        tokenAddress: call.tokenAddress.substring(0, 30),
                        chain: call.chain,
                        callTimestamp: new Date(call.callTimestamp * 1000).toISOString(),
                        caller: call.callerName,
                    });
                    return;
                }
                logger_1.logger.info('✅ Fetched candles for scoring', {
                    tokenAddress: call.tokenAddress.substring(0, 30),
                    chain: call.chain,
                    candlesCount: candles.length,
                    firstCandle: new Date(candles[0].timestamp * 1000).toISOString(),
                    lastCandle: new Date(candles[candles.length - 1].timestamp * 1000).toISOString(),
                    caller: call.callerName,
                });
                // Extract features
                const features = await extractFeatures(call, candles);
                if (!features) {
                    return;
                }
                // Score
                const score = scoreModel(features);
                // Calculate returns
                const returns = calculateReturns(features.price, candles, call.callTimestamp);
                // Build scored call
                const scoredCall = {
                    ...call,
                    score,
                    features,
                    ...returns,
                    performanceCategory: categorizePerformance(returns.maxReturn30d),
                };
                scoredCalls.push(scoredCall);
            }
            catch (error) {
                logger_1.logger.warn('Failed to score call', {
                    tokenAddress: call.tokenAddress.substring(0, 20),
                    error: error.message,
                });
            }
        }));
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    logger_1.logger.info('Scoring complete', {
        total: calls.length,
        scored: scoredCalls.length,
    });
    return scoredCalls;
}
/**
 * Analyze P&L by score ranges
 */
function analyzePnLByScore(scoredCalls) {
    // Sort by score
    scoredCalls.sort((a, b) => b.score - a.score);
    // Define score ranges
    const ranges = [
        { name: 'Top 1%', threshold: 0.01 },
        { name: 'Top 5%', threshold: 0.05 },
        { name: 'Top 10%', threshold: 0.10 },
        { name: 'Top 25%', threshold: 0.25 },
        { name: 'Top 50%', threshold: 0.50 },
        { name: 'Bottom 50%', threshold: 1.0 },
    ];
    console.log('\n💰 P&L ANALYSIS BY SCORE RANGE\n');
    console.log('='.repeat(100));
    for (const range of ranges) {
        let filtered;
        if (range.name === 'Bottom 50%') {
            const threshold = scoredCalls[Math.floor(scoredCalls.length * 0.5)]?.score || 0;
            filtered = scoredCalls.filter(c => c.score <= threshold);
        }
        else {
            const threshold = scoredCalls[Math.floor(scoredCalls.length * (1 - range.threshold))]?.score || 0;
            filtered = scoredCalls.filter(c => c.score >= threshold);
        }
        if (filtered.length === 0)
            continue;
        const avgReturn30d = filtered.reduce((sum, c) => sum + c.maxReturn30d, 0) / filtered.length;
        const avgReturn7d = filtered.reduce((sum, c) => sum + c.maxReturn7d, 0) / filtered.length;
        const medianReturn30d = [...filtered].sort((a, b) => a.maxReturn30d - b.maxReturn30d)[Math.floor(filtered.length / 2)]?.maxReturn30d || 0;
        const moonCount = filtered.filter(c => c.performanceCategory === 'moon').length;
        const goodCount = filtered.filter(c => c.performanceCategory === 'good').length;
        const decentCount = filtered.filter(c => c.performanceCategory === 'decent').length;
        const poorCount = filtered.filter(c => c.performanceCategory === 'poor').length;
        const winRate = (moonCount + goodCount + decentCount) / filtered.length * 100;
        console.log(`\n${range.name} (Score >= ${filtered[0]?.score.toFixed(2)}):`);
        console.log(`  Count: ${filtered.length}`);
        console.log(`  Avg 30d Max Return: ${avgReturn30d.toFixed(2)}x`);
        console.log(`  Avg 7d Max Return: ${avgReturn7d.toFixed(2)}x`);
        console.log(`  Median 30d Return: ${medianReturn30d.toFixed(2)}x`);
        console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
        console.log(`  Performance: Moon ${moonCount}, Good ${goodCount}, Decent ${decentCount}, Poor ${poorCount}`);
    }
    // Top 20 highest scoring
    console.log('\n\n🏆 TOP 20 HIGHEST SCORING TOKENS\n');
    console.log('='.repeat(100));
    const top20 = scoredCalls.slice(0, 20);
    for (const call of top20) {
        console.log(`${(call.tokenSymbol || call.tokenAddress.substring(0, 15)).padEnd(20)} ` +
            `Score: ${call.score.toFixed(2).padStart(6)} | ` +
            `30d Max: ${call.maxReturn30d.toFixed(2)}x | ` +
            `Category: ${call.performanceCategory.padEnd(6)} | ` +
            `Caller: ${call.callerName.substring(0, 20)}`);
    }
}
/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const limit = args[0] ? parseInt(args[0], 10) : undefined;
    logger_1.logger.info('Starting unified calls scoring and analysis', { limit });
    try {
        // Get all calls
        const allCalls = await getAllCalls(limit);
        // Filter out calls with invalid timestamps (before 2020-01-01 = 1577836800)
        // Also filter out calls with timestamp = 1 or 2 (obviously invalid)
        const validCalls = allCalls.filter(call => call.callTimestamp > 1577836800 && call.callTimestamp < 2000000000);
        const invalidCount = allCalls.length - validCalls.length;
        if (invalidCount > 0) {
            logger_1.logger.warn('Filtered out calls with invalid timestamps', {
                total: allCalls.length,
                valid: validCalls.length,
                invalid: invalidCount,
            });
        }
        logger_1.logger.info('Loaded calls', { count: validCalls.length });
        // Build scoring model (weights are hardcoded, so we can use empty array)
        const scoreModel = (0, analyze_brook_token_selection_1.buildScoringModel)([]);
        // Score and analyze
        const scoredCalls = await scoreAndAnalyzeCalls(validCalls, scoreModel);
        // Analyze P&L (only if we have scored calls)
        if (scoredCalls.length > 0) {
            analyzePnLByScore(scoredCalls);
        }
        else {
            logger_1.logger.warn('No calls were successfully scored');
        }
        // Save results
        const outputDir = path.join(process.cwd(), 'data/exports/brook-analysis');
        fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `unified-calls-scored-${luxon_1.DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.json`);
        fs.writeFileSync(outputPath, JSON.stringify(scoredCalls, null, 2));
        // Save summary
        const summary = {
            totalCalls: validCalls.length,
            scoredCalls: scoredCalls.length,
            top10Percent: {
                count: Math.floor(scoredCalls.length * 0.1),
                avgReturn30d: scoredCalls
                    .slice(0, Math.floor(scoredCalls.length * 0.1))
                    .reduce((sum, c) => sum + c.maxReturn30d, 0) / Math.floor(scoredCalls.length * 0.1),
            },
            top25Percent: {
                count: Math.floor(scoredCalls.length * 0.25),
                avgReturn30d: scoredCalls
                    .slice(0, Math.floor(scoredCalls.length * 0.25))
                    .reduce((sum, c) => sum + c.maxReturn30d, 0) / Math.floor(scoredCalls.length * 0.25),
            },
        };
        const summaryPath = path.join(outputDir, `unified-calls-summary-${luxon_1.DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.json`);
        fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
        logger_1.logger.info('Analysis complete', {
            outputPath,
            summaryPath,
        });
        console.log(`\n✅ Results saved to: ${outputPath}`);
        console.log(`📊 Summary saved to: ${summaryPath}`);
    }
    catch (error) {
        logger_1.logger.error('Analysis failed', error);
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=score-and-analyze-unified-calls.js.map