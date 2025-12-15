/**
 * Rolling Window Validation of Scoring Model
 *
 * Validates that high-scored tokens actually correlate with future success
 * by using a rolling window approach:
 * 1. Split calls into time windows
 * 2. Train scoring model on data BEFORE each window
 * 3. Score tokens in that window using only data available at call time
 * 4. Compare predicted scores vs actual returns
 * 5. Calculate correlation metrics
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildScoringModel,
  type TokenFeatures,
  type CallAnalysis,
} from './analyze-brook-token-selection';
import { queryCandles } from '../../src/storage/clickhouse-client';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { logger } from '../../src/utils/logger';
import { getCachedResponse, cacheResponse, cacheNoDataResponse } from './cache-manager';
import { UNIFIED_DB_PATH } from './create-unified-calls-table';

config();

interface UnifiedCall {
  id: number;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  callTimestamp: number;
  priceAtCall?: number;
  volumeAtCall?: number;
  marketCapAtCall?: number;
  callerName: string;
}

interface ScoredCall {
  call: UnifiedCall;
  score: number;
  features: TokenFeatures;
  maxReturn7d: number;
  maxReturn30d: number;
  returnAt7d: number;
  returnAt30d: number;
  maxMcap7d?: number;
  maxMcap30d?: number;
  mcapAt7d?: number;
  mcapAt30d?: number;
}

interface WindowValidation {
  windowStart: number;
  windowEnd: number;
  trainingCalls: number;
  testCalls: number;
  scoredCalls: number;
  correlation7d: number;
  correlation30d: number;
  top10PercentAvgReturn7d: number;
  top10PercentAvgReturn30d: number;
  bottom10PercentAvgReturn7d: number;
  bottom10PercentAvgReturn30d: number;
  precisionTop10: number; // % of top 10% by score that had >3x return
  precisionTop25: number;
  recallTop10: number; // % of all >3x returns that were in top 10% by score
  recallTop25: number;
}

/**
 * Get all calls with valid timestamps
 */
async function getAllCalls(): Promise<UnifiedCall[]> {
  return new Promise((resolve, reject) => {
    const db = new Database(UNIFIED_DB_PATH, (err) => {
      if (err) {
        logger.error('Failed to open unified database', err as Error);
        return reject(err);
      }
    });

    const all = promisify(db.all.bind(db)) as (sql: string, params?: any[]) => Promise<any[]>;

    const query = `SELECT * FROM unified_calls 
      WHERE call_timestamp > 1577836800 AND call_timestamp < 2000000000 
      ORDER BY call_timestamp ASC`;

    all(query, [])
      .then((rows: any[]) => {
        db.close();
        const calls: UnifiedCall[] = rows.map((row) => ({
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
 * Extract features from call and candles
 */
async function extractFeatures(
  call: UnifiedCall,
  candles: Array<{ timestamp: number; price: number; volume: number }>
): Promise<TokenFeatures | null> {
  if (candles.length === 0) return null;

  const callUnix = call.callTimestamp;
  const callCandle = candles.find((c) => Math.abs(c.timestamp - callUnix) < 300); // Within 5 minutes
  const callPrice = callCandle?.price || call.priceAtCall || candles[0]?.price || 0;

  if (callPrice === 0) {
    logger.debug('No valid price found', { tokenAddress: call.tokenAddress.substring(0, 20) });
    return null;
  }

  // Price changes
  const oneHourAgo = callUnix - 3600;
  const oneDayAgo = callUnix - 86400;
  const fifteenMinAgo = callUnix - 900;

  const price1hAgo =
    candles.find((c) => Math.abs(c.timestamp - oneHourAgo) < 300)?.price || callPrice;
  const price24hAgo =
    candles.find((c) => Math.abs(c.timestamp - oneDayAgo) < 600)?.price || callPrice;
  const price15mAgo =
    candles.find((c) => Math.abs(c.timestamp - fifteenMinAgo) < 180)?.price || callPrice;

  const priceChange1h = ((callPrice - price1hAgo) / price1hAgo) * 100;
  const priceChange24h = ((callPrice - price24hAgo) / price24hAgo) * 100;
  const priceChange15m = ((callPrice - price15mAgo) / price15mAgo) * 100;

  // Volume
  const callVolume = callCandle?.volume || call.volumeAtCall || 0;
  const volume1hAgo = candles.find((c) => Math.abs(c.timestamp - oneHourAgo) < 300)?.volume || 0;
  const volumeChange1h = volume1hAgo > 0 ? ((callVolume - volume1hAgo) / volume1hAgo) * 100 : 0;

  // Average volume 24h
  const candles24h = candles.filter((c) => c.timestamp >= oneDayAgo && c.timestamp <= callUnix);
  const avgVolume24h =
    candles24h.length > 0
      ? candles24h.reduce((sum, c) => sum + c.volume, 0) / candles24h.length
      : callVolume;

  // Market cap
  const marketCap = call.marketCapAtCall || 0;
  let marketCapCategory: 'micro' | 'small' | 'mid' | 'large' = 'micro';
  if (marketCap >= 100_000_000) marketCapCategory = 'large';
  else if (marketCap >= 10_000_000) marketCapCategory = 'mid';
  else if (marketCap >= 1_000_000) marketCapCategory = 'small';

  // Timing
  const callDate = DateTime.fromSeconds(callUnix);
  const hourOfDay = callDate.hour;
  const dayOfWeek = callDate.weekday % 7; // 0 = Sunday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Volatility (std dev of price changes in 24h)
  const priceChanges = [];
  for (let i = 1; i < candles24h.length; i++) {
    if (candles24h[i - 1].price > 0) {
      const change =
        ((candles24h[i].price - candles24h[i - 1].price) / candles24h[i - 1].price) * 100;
      priceChanges.push(change);
    }
  }
  const avgChange =
    priceChanges.length > 0 ? priceChanges.reduce((sum, c) => sum + c, 0) / priceChanges.length : 0;
  const variance =
    priceChanges.length > 0
      ? priceChanges.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / priceChanges.length
      : 0;
  const volatility24h = Math.sqrt(variance);

  return {
    price: callPrice,
    volume: callVolume,
    marketCap,
    priceChange1h,
    priceChange24h,
    priceChange15m,
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
async function fetchCandlesForAnalysis(
  tokenAddress: string,
  callUnix: number,
  chain: string = 'solana'
): Promise<Array<{ timestamp: number; price: number; volume: number }>> {
  const startTime = DateTime.fromSeconds(callUnix - 86400); // 1 day before
  const endTime = DateTime.fromSeconds(callUnix + 2592000); // 30 days after

  // Try ClickHouse first
  try {
    const clickhouseCandles = await queryCandles(tokenAddress, chain, startTime, endTime, '5m');

    if (clickhouseCandles && clickhouseCandles.length > 0) {
      return clickhouseCandles.map((candle) => ({
        timestamp: candle.timestamp,
        price: candle.close,
        volume: candle.volume,
      }));
    }
  } catch (error: any) {
    logger.debug('ClickHouse query failed', { error: error.message });
  }

  // Fall back to Birdeye API
  const startUnix = startTime.toSeconds();
  const endUnix = endTime.toSeconds();
  const cached = getCachedResponse(tokenAddress, chain, startUnix, endUnix, '5m');

  if (cached !== null) {
    const cachedData = cached.data;
    if (
      cachedData &&
      cachedData.items &&
      Array.isArray(cachedData.items) &&
      cachedData.items.length > 0
    ) {
      return cachedData.items.map((item: any) => ({
        timestamp: item.unixTime,
        price: typeof item.close === 'string' ? parseFloat(item.close) : item.close || 0,
        volume: typeof item.volume === 'string' ? parseFloat(item.volume) : item.volume || 0,
      }));
    }
  }

  try {
    const birdeyeData = await birdeyeClient.fetchOHLCVData(
      tokenAddress,
      new Date(startUnix * 1000),
      new Date(endUnix * 1000),
      '5m',
      chain
    );

    if (birdeyeData && birdeyeData.items && birdeyeData.items.length > 0) {
      cacheResponse(tokenAddress, chain, startUnix, endUnix, '5m', birdeyeData);
      return birdeyeData.items.map((item) => ({
        timestamp: item.unixTime,
        price: typeof item.close === 'string' ? parseFloat(item.close) : item.close || 0,
        volume: typeof item.volume === 'string' ? parseFloat(item.volume) : item.volume || 0,
      }));
    } else {
      cacheNoDataResponse(tokenAddress, chain, startUnix, endUnix, '5m');
    }
  } catch (error: any) {
    logger.debug('API fetch failed', { error: error.message });
  }

  return [];
}

/**
 * Calculate returns
 */
function calculateReturns(
  callPrice: number,
  candles: Array<{ timestamp: number; price: number; volume: number }>,
  callUnix: number,
  entryMcap?: number
): {
  maxReturn7d: number;
  maxReturn30d: number;
  returnAt7d: number;
  returnAt30d: number;
  maxMcap7d?: number;
  maxMcap30d?: number;
  mcapAt7d?: number;
  mcapAt30d?: number;
} {
  const candlesAfter = candles.filter((c) => c.timestamp > callUnix);
  if (candlesAfter.length === 0) {
    return { maxReturn7d: 1, maxReturn30d: 1, returnAt7d: 1, returnAt30d: 1 };
  }

  const sevenDays = callUnix + 604800;
  const thirtyDays = callUnix + 2592000;

  const candles7d = candlesAfter.filter((c) => c.timestamp <= sevenDays);
  const candles30d = candlesAfter.filter((c) => c.timestamp <= thirtyDays);

  const maxPrice7d = candles7d.length > 0 ? Math.max(...candles7d.map((c) => c.price)) : callPrice;
  const maxPrice30d =
    candles30d.length > 0 ? Math.max(...candles30d.map((c) => c.price)) : callPrice;

  const priceAt7d = candles7d.length > 0 ? candles7d[candles7d.length - 1].price : callPrice;
  const priceAt30d = candles30d.length > 0 ? candles30d[candles30d.length - 1].price : callPrice;

  const priceMultiple7d = maxPrice7d / callPrice;
  const priceMultiple30d = maxPrice30d / callPrice;
  const priceMultipleAt7d = priceAt7d / callPrice;
  const priceMultipleAt30d = priceAt30d / callPrice;

  const result: any = {
    maxReturn7d: priceMultiple7d,
    maxReturn30d: priceMultiple30d,
    returnAt7d: priceMultipleAt7d,
    returnAt30d: priceMultipleAt30d,
  };

  if (entryMcap) {
    result.maxMcap7d = entryMcap * priceMultiple7d;
    result.maxMcap30d = entryMcap * priceMultiple30d;
    result.mcapAt7d = entryMcap * priceMultipleAt7d;
    result.mcapAt30d = entryMcap * priceMultipleAt30d;
  }

  return result;
}

/**
 * Calculate Pearson correlation
 */
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Validate scoring on a rolling window
 */
async function validateRollingWindow(
  trainingCalls: UnifiedCall[],
  testCalls: UnifiedCall[],
  windowStart: number,
  windowEnd: number
): Promise<WindowValidation> {
  logger.info('Validating window', {
    windowStart: new Date(windowStart * 1000).toISOString(),
    windowEnd: new Date(windowEnd * 1000).toISOString(),
    trainingCount: trainingCalls.length,
    testCount: testCalls.length,
  });

  // Build scoring model from training data
  const trainingAnalyses: CallAnalysis[] = [];

  // Limit training calls to avoid excessive processing
  const maxTrainingCalls = Math.min(50, trainingCalls.length);

  logger.info('Processing training calls', {
    total: maxTrainingCalls,
    window: `${new Date(windowStart * 1000).toISOString().split('T')[0]} to ${new Date(windowEnd * 1000).toISOString().split('T')[0]}`,
  });

  let trainingProcessed = 0;
  for (const call of trainingCalls.slice(-maxTrainingCalls)) {
    // Use most recent training calls
    trainingProcessed++;
    if (trainingProcessed % 10 === 0) {
      logger.debug('Training progress', { processed: trainingProcessed, total: maxTrainingCalls });
    }

    try {
      const candles = await fetchCandlesForAnalysis(
        call.tokenAddress,
        call.callTimestamp,
        call.chain
      );
      if (candles.length === 0) continue;

      const features = await extractFeatures(call, candles);
      if (!features) continue;

      const returns = calculateReturns(
        features.price,
        candles,
        call.callTimestamp,
        features.marketCap
      );

      const performanceCategory =
        returns.maxReturn30d > 10
          ? 'moon'
          : returns.maxReturn30d > 3
            ? 'good'
            : returns.maxReturn30d > 1.5
              ? 'decent'
              : 'poor';

      trainingAnalyses.push({
        ...features,
        tokenAddress: call.tokenAddress,
        tokenSymbol: call.tokenSymbol,
        callTimestamp: DateTime.fromSeconds(call.callTimestamp).toJSDate(),
        maxReturn7d: returns.maxReturn7d,
        maxReturn30d: returns.maxReturn30d,
        returnAt7d: returns.returnAt7d,
        returnAt30d: returns.returnAt30d,
        performanceCategory,
      });
    } catch (error: any) {
      logger.debug('Error processing training call', { error: error.message });
    }
  }

  // Build model from training analyses
  logger.info('Building scoring model', { trainingAnalyses: trainingAnalyses.length });
  const scoreModel = buildScoringModel(trainingAnalyses);

  // Score test calls
  logger.info('Scoring test calls', { total: testCalls.length });
  const scoredTestCalls: ScoredCall[] = [];

  let testProcessed = 0;
  for (const call of testCalls) {
    testProcessed++;
    if (testProcessed % 50 === 0) {
      logger.info('Test progress', {
        processed: testProcessed,
        total: testCalls.length,
        scored: scoredTestCalls.length,
      });
    }

    try {
      const candles = await fetchCandlesForAnalysis(
        call.tokenAddress,
        call.callTimestamp,
        call.chain
      );
      if (candles.length === 0) continue;

      const features = await extractFeatures(call, candles);
      if (!features) continue;

      const score = scoreModel(features);
      const returns = calculateReturns(
        features.price,
        candles,
        call.callTimestamp,
        features.marketCap
      );

      scoredTestCalls.push({
        call,
        score,
        features,
        ...returns,
      });
    } catch (error: any) {
      logger.debug('Error processing test call', { error: error.message });
    }
  }

  if (scoredTestCalls.length === 0) {
    return {
      windowStart,
      windowEnd,
      trainingCalls: trainingCalls.length,
      testCalls: testCalls.length,
      scoredCalls: 0,
      correlation7d: 0,
      correlation30d: 0,
      top10PercentAvgReturn7d: 0,
      top10PercentAvgReturn30d: 0,
      bottom10PercentAvgReturn7d: 0,
      bottom10PercentAvgReturn30d: 0,
      precisionTop10: 0,
      precisionTop25: 0,
      recallTop10: 0,
      recallTop25: 0,
    };
  }

  // Calculate correlations
  const scores = scoredTestCalls.map((s) => s.score);
  const returns7d = scoredTestCalls.map((s) => s.maxReturn7d);
  const returns30d = scoredTestCalls.map((s) => s.maxReturn30d);

  const correlation7d = calculateCorrelation(scores, returns7d);
  const correlation30d = calculateCorrelation(scores, returns30d);

  // Sort by score
  scoredTestCalls.sort((a, b) => b.score - a.score);

  // Top/bottom 10%
  const top10Count = Math.max(1, Math.floor(scoredTestCalls.length * 0.1));
  const bottom10Count = Math.max(1, Math.floor(scoredTestCalls.length * 0.1));

  const top10 = scoredTestCalls.slice(0, top10Count);
  const bottom10 = scoredTestCalls.slice(-bottom10Count);

  const top10PercentAvgReturn7d = top10.reduce((sum, s) => sum + s.maxReturn7d, 0) / top10.length;
  const top10PercentAvgReturn30d = top10.reduce((sum, s) => sum + s.maxReturn30d, 0) / top10.length;
  const bottom10PercentAvgReturn7d =
    bottom10.reduce((sum, s) => sum + s.maxReturn7d, 0) / bottom10.length;
  const bottom10PercentAvgReturn30d =
    bottom10.reduce((sum, s) => sum + s.maxReturn30d, 0) / bottom10.length;

  // Precision/Recall
  const top10Percent = scoredTestCalls.slice(0, top10Count);
  const top25Percent = scoredTestCalls.slice(
    0,
    Math.max(1, Math.floor(scoredTestCalls.length * 0.25))
  );

  const allWinners7d = scoredTestCalls.filter((s) => s.maxReturn7d > 3).length;
  const allWinners30d = scoredTestCalls.filter((s) => s.maxReturn30d > 3).length;

  const top10Winners7d = top10Percent.filter((s) => s.maxReturn7d > 3).length;
  const top10Winners30d = top10Percent.filter((s) => s.maxReturn30d > 3).length;
  const top25Winners7d = top25Percent.filter((s) => s.maxReturn7d > 3).length;
  const top25Winners30d = top25Percent.filter((s) => s.maxReturn30d > 3).length;

  const precisionTop10 = top10Count > 0 ? (top10Winners7d / top10Count) * 100 : 0;
  const precisionTop25 = top25Percent.length > 0 ? (top25Winners7d / top25Percent.length) * 100 : 0;
  const recallTop10 = allWinners7d > 0 ? (top10Winners7d / allWinners7d) * 100 : 0;
  const recallTop25 = allWinners7d > 0 ? (top25Winners7d / allWinners7d) * 100 : 0;

  return {
    windowStart,
    windowEnd,
    trainingCalls: trainingCalls.length,
    testCalls: testCalls.length,
    scoredCalls: scoredTestCalls.length,
    correlation7d,
    correlation30d,
    top10PercentAvgReturn7d,
    top10PercentAvgReturn30d,
    bottom10PercentAvgReturn7d,
    bottom10PercentAvgReturn30d,
    precisionTop10,
    precisionTop25,
    recallTop10,
    recallTop25,
  };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const windowSizeDays = args[0] ? parseInt(args[0], 10) : 30; // Default 30-day windows
  const windowStepDays = args[1] ? parseInt(args[1], 10) : 15; // Default 15-day step (50% overlap)

  logger.info('Starting rolling window validation', {
    windowSizeDays,
    windowStepDays,
  });

  const allCalls = await getAllCalls();
  logger.info('Loaded calls', { count: allCalls.length });

  if (allCalls.length < 100) {
    logger.error('Not enough calls for validation', { count: allCalls.length });
    return;
  }

  // Sort by timestamp
  allCalls.sort((a, b) => a.callTimestamp - b.callTimestamp);

  const firstTimestamp = allCalls[0].callTimestamp;
  const lastTimestamp = allCalls[allCalls.length - 1].callTimestamp;

  // Create rolling windows
  const validations: WindowValidation[] = [];
  let windowStart = firstTimestamp;
  let windowIndex = 0;
  const totalWindows = Math.ceil((lastTimestamp - firstTimestamp) / (windowStepDays * 86400));

  logger.info('Creating validation windows', { totalWindows });

  while (windowStart < lastTimestamp) {
    windowIndex++;
    const windowEnd = windowStart + windowSizeDays * 86400;

    // Training: all calls before window
    const trainingCalls = allCalls.filter((c) => c.callTimestamp < windowStart);

    // Test: calls in window
    const testCalls = allCalls.filter(
      (c) => c.callTimestamp >= windowStart && c.callTimestamp < windowEnd
    );

    if (trainingCalls.length >= 50 && testCalls.length >= 10) {
      logger.info(`Processing window ${windowIndex}/${totalWindows}`, {
        windowStart: new Date(windowStart * 1000).toISOString().split('T')[0],
        windowEnd: new Date(windowEnd * 1000).toISOString().split('T')[0],
        trainingCalls: trainingCalls.length,
        testCalls: testCalls.length,
      });

      const validation = await validateRollingWindow(
        trainingCalls,
        testCalls,
        windowStart,
        windowEnd
      );
      validations.push(validation);

      logger.info(`Window ${windowIndex} complete`, {
        scoredCalls: validation.scoredCalls,
        correlation30d: validation.correlation30d.toFixed(3),
      });
    }

    windowStart += windowStepDays * 86400;
  }

  // Aggregate results
  const avgCorrelation7d =
    validations.reduce((sum, v) => sum + v.correlation7d, 0) / validations.length;
  const avgCorrelation30d =
    validations.reduce((sum, v) => sum + v.correlation30d, 0) / validations.length;
  const avgPrecisionTop10 =
    validations.reduce((sum, v) => sum + v.precisionTop10, 0) / validations.length;
  const avgPrecisionTop25 =
    validations.reduce((sum, v) => sum + v.precisionTop25, 0) / validations.length;
  const avgRecallTop10 =
    validations.reduce((sum, v) => sum + v.recallTop10, 0) / validations.length;
  const avgRecallTop25 =
    validations.reduce((sum, v) => sum + v.recallTop25, 0) / validations.length;
  const avgTop10Return7d =
    validations.reduce((sum, v) => sum + v.top10PercentAvgReturn7d, 0) / validations.length;
  const avgTop10Return30d =
    validations.reduce((sum, v) => sum + v.top10PercentAvgReturn30d, 0) / validations.length;
  const avgBottom10Return7d =
    validations.reduce((sum, v) => sum + v.bottom10PercentAvgReturn7d, 0) / validations.length;
  const avgBottom10Return30d =
    validations.reduce((sum, v) => sum + v.bottom10PercentAvgReturn30d, 0) / validations.length;

  // Output results
  const outputDir = path.join(process.cwd(), 'data/exports/brook-analysis');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss');
  const outputPath = path.join(outputDir, `scoring-validation-${timestamp}.json`);

  const results = {
    summary: {
      totalWindows: validations.length,
      windowSizeDays,
      windowStepDays,
      avgCorrelation7d,
      avgCorrelation30d,
      avgPrecisionTop10,
      avgPrecisionTop25,
      avgRecallTop10,
      avgRecallTop25,
      avgTop10Return7d,
      avgTop10Return30d,
      avgBottom10Return7d,
      avgBottom10Return30d,
      top10Outperformance7d: avgTop10Return7d / avgBottom10Return7d,
      top10Outperformance30d: avgTop10Return30d / avgBottom10Return30d,
    },
    windows: validations,
  };

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  logger.info('Validation complete', {
    outputPath,
    windows: validations.length,
    avgCorrelation7d: avgCorrelation7d.toFixed(3),
    avgCorrelation30d: avgCorrelation30d.toFixed(3),
    avgPrecisionTop10: avgPrecisionTop10.toFixed(1) + '%',
    avgPrecisionTop25: avgPrecisionTop25.toFixed(1) + '%',
    top10Outperformance30d: (avgTop10Return30d / avgBottom10Return30d).toFixed(2) + 'x',
  });

  console.log('\n=== VALIDATION SUMMARY ===');
  console.log(`Windows analyzed: ${validations.length}`);
  console.log(`\nCorrelation (Score vs Returns):`);
  console.log(`  7-day:  ${(avgCorrelation7d * 100).toFixed(1)}%`);
  console.log(`  30-day: ${(avgCorrelation30d * 100).toFixed(1)}%`);
  console.log(`\nPrecision (Top-scored tokens that actually performed):`);
  console.log(`  Top 10%: ${avgPrecisionTop10.toFixed(1)}%`);
  console.log(`  Top 25%: ${avgPrecisionTop25.toFixed(1)}%`);
  console.log(`\nAverage Returns:`);
  console.log(`  Top 10% by score (7d):  ${avgTop10Return7d.toFixed(2)}x`);
  console.log(`  Top 10% by score (30d): ${avgTop10Return30d.toFixed(2)}x`);
  console.log(`  Bottom 10% by score (7d):  ${avgBottom10Return7d.toFixed(2)}x`);
  console.log(`  Bottom 10% by score (30d): ${avgBottom10Return30d.toFixed(2)}x`);
  console.log(`\nOutperformance:`);
  console.log(
    `  Top 10% vs Bottom 10% (7d):  ${(avgTop10Return7d / avgBottom10Return7d).toFixed(2)}x`
  );
  console.log(
    `  Top 10% vs Bottom 10% (30d): ${(avgTop10Return30d / avgBottom10Return30d).toFixed(2)}x`
  );
  console.log(`\n✅ Results saved to: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error', error as Error);
    process.exit(1);
  });
}

export { validateRollingWindow, WindowValidation };
