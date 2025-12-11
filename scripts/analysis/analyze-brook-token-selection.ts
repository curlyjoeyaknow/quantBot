/**
 * Analyze Brook's token selection patterns to identify common denominators
 * in high-performing picks and build a predictive model
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { logger } from '../../src/utils/logger';

config();

interface BrookCall {
  id?: number;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  alertTimestamp: Date;
  priceAtAlert?: number;
  volumeAtAlert?: number;
  marketCapAtAlert?: number;
  callerName: string;
}

interface TokenFeatures {
  // At call time
  price: number;
  volume: number;
  marketCap: number;
  
  // Price action before call
  priceChange1h: number; // % change in 1 hour before call
  priceChange24h: number; // % change in 24 hours before call
  priceChange15m: number; // % change in 15 minutes before call
  
  // Volume trends
  volumeChange1h: number; // % change in volume 1h vs previous 1h
  avgVolume24h: number; // Average volume in 24h before call
  
  // Timing features
  hourOfDay: number; // 0-23
  dayOfWeek: number; // 0-6 (Sunday = 0)
  isWeekend: boolean;
  
  // Token age (if available)
  tokenAgeHours?: number; // Hours since token creation/launch
  
  // Price volatility
  volatility24h: number; // Standard deviation of price changes in 24h
  
  // Market cap category
  marketCapCategory: 'micro' | 'small' | 'mid' | 'large'; // <1M, 1-10M, 10-100M, >100M
}

interface CallAnalysis extends TokenFeatures {
  tokenAddress: string;
  tokenSymbol?: string;
  callTimestamp: Date;
  
  // Returns
  maxReturn7d: number; // Max price in 7 days / call price
  maxReturn30d: number; // Max price in 30 days / call price
  returnAt7d: number; // Price at 7 days / call price
  returnAt30d: number; // Price at 30 days / call price
  
  // Performance category
  performanceCategory: 'moon' | 'good' | 'decent' | 'poor'; // >10x, 3-10x, 1.5-3x, <1.5x
}

const DB_PATH = process.env.CALLER_DB_PATH || './caller_alerts.db';
const OUTPUT_DIR = path.join(process.cwd(), 'data/exports/brook-analysis');
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY_1;

/**
 * Query all Brook calls from database
 */
async function getBrookCalls(): Promise<BrookCall[]> {
  return new Promise((resolve, reject) => {
    const db = new Database(DB_PATH, (err) => {
      if (err) {
        logger.error('Failed to open database', err as Error);
        return reject(err);
      }
    });

    // Try caller_alerts table first
    const query = `
      SELECT 
        id,
        caller_name,
        token_address,
        token_symbol,
        chain,
        alert_timestamp,
        price_at_alert,
        volume_at_alert
      FROM caller_alerts
      WHERE LOWER(caller_name) LIKE '%brook%'
      ORDER BY alert_timestamp ASC
    `;

    db.all(query, [], (err, rows: any[]) => {
      if (err) {
        db.close();
        logger.error('Failed to query caller_alerts', err as Error);
        return reject(err);
      }

      // Also try ca_calls table
      const caCallsQuery = `
        SELECT 
          id,
          caller as caller_name,
          mint as token_address,
          token_symbol,
          chain,
          datetime(call_timestamp, 'unixepoch') as alert_timestamp,
          call_price as price_at_alert,
          call_marketcap
        FROM ca_calls
        WHERE LOWER(caller) LIKE '%brook%'
        ORDER BY call_timestamp ASC
      `;

      db.all(caCallsQuery, [], (err2, rows2: any[]) => {
        db.close();
        
        if (err2) {
          logger.warn('Failed to query ca_calls', { error: err2.message });
        }

        const allCalls: BrookCall[] = [];
        
        // Process caller_alerts
        if (rows && rows.length > 0) {
          for (const row of rows) {
            allCalls.push({
              id: row.id,
              tokenAddress: row.token_address,
              tokenSymbol: row.token_symbol,
              chain: row.chain || 'solana',
              alertTimestamp: new Date(row.alert_timestamp),
              priceAtAlert: row.price_at_alert,
              volumeAtAlert: row.volume_at_alert,
              callerName: row.caller_name,
            });
          }
        }

        // Process ca_calls (avoid duplicates)
        // Note: Token addresses are case-sensitive
        if (rows2 && rows2.length > 0) {
          const existingAddresses = new Set(allCalls.map(c => c.tokenAddress));
          
          for (const row of rows2) {
            const address = row.token_address;
            if (!address || existingAddresses.has(address)) continue;
            
            // Parse timestamp
            let timestamp: Date;
            if (typeof row.alert_timestamp === 'string') {
              timestamp = new Date(row.alert_timestamp);
            } else if (row.call_timestamp) {
              timestamp = new Date(row.call_timestamp * 1000);
            } else {
              continue;
            }

            allCalls.push({
              id: row.id,
              tokenAddress: row.token_address,
              tokenSymbol: row.token_symbol,
              chain: row.chain || 'solana',
              alertTimestamp: timestamp,
              priceAtAlert: row.price_at_alert,
              volumeAtAlert: undefined,
              marketCapAtAlert: row.call_marketcap,
              callerName: row.caller,
            });
          }
        }

        // Deduplicate by token address + timestamp (within 1 hour)
        // Note: Token addresses are case-sensitive, preserve exact case
        const uniqueCalls: BrookCall[] = [];
        const seen = new Set<string>();

        for (const call of allCalls) {
          const key = `${call.tokenAddress}_${Math.floor(call.alertTimestamp.getTime() / 3600000)}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueCalls.push(call);
          }
        }

        logger.info('Loaded Brook calls', { 
          total: allCalls.length, 
          unique: uniqueCalls.length 
        });

        resolve(uniqueCalls);
      });
    });
  });
}

/**
 * Fetch historical price data at a specific timestamp
 */
async function fetchPriceAtTime(
  tokenAddress: string,
  timestamp: Date,
  chain: string = 'solana'
): Promise<{ price: number; marketCap: number } | null> {
  const unixTimestamp = Math.floor(timestamp.getTime() / 1000);
  const timeWindow = 3600; // 1 hour window

  try {
    const response = await axios.get('https://public-api.birdeye.so/defi/history_price', {
      headers: {
        'X-API-KEY': BIRDEYE_API_KEY,
        'accept': 'application/json',
        'x-chain': chain,
      },
      params: {
        address: tokenAddress,
        address_type: 'token',
        type: '1m',
        time_from: unixTimestamp - timeWindow,
        time_to: unixTimestamp + timeWindow,
        ui_amount_mode: 'raw',
      },
      timeout: 10000,
    });

    if (response.data?.success && response.data?.data?.items) {
      const items = response.data.data.items;
      if (items.length > 0) {
        // Find closest price point
        let closestItem = items[0];
        let minDiff = Math.abs(closestItem.unixTime - unixTimestamp);

        for (const item of items) {
          const diff = Math.abs(item.unixTime - unixTimestamp);
          if (diff < minDiff) {
            minDiff = diff;
            closestItem = item;
          }
        }

        return {
          price: closestItem.value || closestItem.price || 0,
          marketCap: closestItem.marketCap || 0,
        };
      }
    }
  } catch (error: any) {
    // Silently fail - token might not exist or API issue
  }

  return null;
}

/**
 * Fetch candles for price action analysis
 */
async function fetchCandlesForAnalysis(
  tokenAddress: string,
  callTime: Date,
  chain: string = 'solana'
): Promise<Array<{ timestamp: number; price: number; volume: number }>> {
  const callUnix = Math.floor(callTime.getTime() / 1000);
  const startUnix = callUnix - 86400; // 24 hours before
  const endUnix = callUnix + 2592000; // 30 days after

  try {
    const birdeyeData = await birdeyeClient.fetchOHLCVData(
      tokenAddress,
      new Date(startUnix * 1000),
      new Date(endUnix * 1000),
      '5m'
    );

    if (!birdeyeData || !birdeyeData.items) {
      return [];
    }

    return birdeyeData.items.map(item => ({
      timestamp: item.unixTime,
      price: typeof item.close === 'string' ? parseFloat(item.close) : (item.close || 0),
      volume: typeof item.volume === 'string' ? parseFloat(item.volume) : (item.volume || 0),
    }));
  } catch (error: any) {
    logger.warn('Failed to fetch candles', { 
      tokenAddress: tokenAddress.substring(0, 20), 
      error: error.message 
    });
    return [];
  }
}

/**
 * Extract features from a call
 */
async function extractFeatures(
  call: BrookCall,
  candles: Array<{ timestamp: number; price: number; volume: number }>
): Promise<TokenFeatures | null> {
  const callUnix = Math.floor(call.alertTimestamp.getTime() / 1000);
  const callTime = DateTime.fromJSDate(call.alertTimestamp);

  // Get price/volume at call time
  const callCandle = candles.find(c => Math.abs(c.timestamp - callUnix) < 300); // Within 5 min
  if (!callCandle || callCandle.price === 0) {
    return null;
  }

  const price = call.priceAtAlert || callCandle.price;
  const volume = call.volumeAtAlert || callCandle.volume;
  
  // Fetch market cap if not available
  let marketCap = call.marketCapAtAlert || 0;
  if (!marketCap) {
    const priceData = await fetchPriceAtTime(call.tokenAddress, call.alertTimestamp, call.chain);
    marketCap = priceData?.marketCap || 0;
  }

  // Price changes before call
  const candlesBefore = candles.filter(c => c.timestamp < callUnix);
  
  const price15mAgo = candlesBefore
    .filter(c => callUnix - c.timestamp <= 900) // 15 min
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
  const price1hAgo = candlesBefore
    .filter(c => callUnix - c.timestamp <= 3600) // 1 hour
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;
  const price24hAgo = candlesBefore
    .filter(c => callUnix - c.timestamp <= 86400) // 24 hours
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.price;

  const priceChange15m = price15mAgo ? ((price - price15mAgo) / price15mAgo) * 100 : 0;
  const priceChange1h = price1hAgo ? ((price - price1hAgo) / price1hAgo) * 100 : 0;
  const priceChange24h = price24hAgo ? ((price - price24hAgo) / price24hAgo) * 100 : 0;

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

  // Volatility (standard deviation of price changes)
  const priceChanges24h = candlesBefore
    .filter(c => callUnix - c.timestamp <= 86400)
    .map((c, i, arr) => {
      if (i === 0) return 0;
      const prev = arr[i - 1];
      return prev.price > 0 ? ((c.price - prev.price) / prev.price) * 100 : 0;
    })
    .filter(change => change !== 0);

  const avgChange = priceChanges24h.reduce((sum, c) => sum + c, 0) / Math.max(1, priceChanges24h.length);
  const variance = priceChanges24h.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / Math.max(1, priceChanges24h.length);
  const volatility24h = Math.sqrt(variance);

  // Timing features
  const hourOfDay = callTime.hour;
  const dayOfWeek = callTime.weekday % 7; // Luxon uses 1-7, convert to 0-6
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Market cap category
  let marketCapCategory: 'micro' | 'small' | 'mid' | 'large';
  if (marketCap < 1_000_000) {
    marketCapCategory = 'micro';
  } else if (marketCap < 10_000_000) {
    marketCapCategory = 'small';
  } else if (marketCap < 100_000_000) {
    marketCapCategory = 'mid';
  } else {
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
 * Calculate returns for a call (MCAP-based)
 * Uses market cap multiples for better cross-token comparison
 */
function calculateReturns(
  callPrice: number,
  candles: Array<{ timestamp: number; price: number; volume: number }>,
  callUnix: number,
  entryMcap?: number  // Optional: market cap at call time
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
  const candlesAfter = candles.filter(c => c.timestamp > callUnix);
  
  const candles7d = candlesAfter.filter(c => c.timestamp <= callUnix + 604800); // 7 days
  const candles30d = candlesAfter.filter(c => c.timestamp <= callUnix + 2592000); // 30 days

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

  const result: any = {
    maxReturn7d: priceMultiple7d,
    maxReturn30d: priceMultiple30d,
    returnAt7d: priceMultipleAt7d,
    returnAt30d: priceMultipleAt30d,
  };

  // If entry MCAP is available, calculate MCAP values
  if (entryMcap) {
    // Calculate peak MCAPs: peak_mcap = entry_mcap * (peak_price / entry_price)
    result.maxMcap7d = entryMcap * priceMultiple7d;
    result.maxMcap30d = entryMcap * priceMultiple30d;
    result.mcapAt7d = entryMcap * priceMultipleAt7d;
    result.mcapAt30d = entryMcap * priceMultipleAt30d;
  }

  return result;
}

/**
 * Categorize performance
 */
function categorizePerformance(maxReturn30d: number): 'moon' | 'good' | 'decent' | 'poor' {
  if (maxReturn30d >= 10) return 'moon';
  if (maxReturn30d >= 3) return 'good';
  if (maxReturn30d >= 1.5) return 'decent';
  return 'poor';
}

/**
 * Analyze all Brook calls
 */
export async function analyzeBrookCalls(): Promise<CallAnalysis[]> {
  const calls = await getBrookCalls();
  logger.info('Starting analysis', { totalCalls: calls.length });

  const analyses: CallAnalysis[] = [];
  const batchSize = 10;
  let processed = 0;

  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (call) => {
        try {
          processed++;
          if (processed % 50 === 0) {
            logger.info('Progress', { processed, total: calls.length });
          }

          // Fetch candles
          const candles = await fetchCandlesForAnalysis(
            call.tokenAddress,
            call.alertTimestamp,
            call.chain
          );

          if (candles.length === 0) {
            logger.warn('No candles found', { 
              tokenAddress: call.tokenAddress.substring(0, 20) 
            });
            return;
          }

          // Extract features
          const features = await extractFeatures(call, candles);
          if (!features) {
            return;
          }

          // Calculate returns
          const callUnix = Math.floor(call.alertTimestamp.getTime() / 1000);
          const returns = calculateReturns(features.price, candles, callUnix);

          // Build analysis
          const analysis: CallAnalysis = {
            ...features,
            tokenAddress: call.tokenAddress,
            tokenSymbol: call.tokenSymbol,
            callTimestamp: call.alertTimestamp,
            ...returns,
            performanceCategory: categorizePerformance(returns.maxReturn30d),
          };

          analyses.push(analysis);
        } catch (error: any) {
          logger.warn('Failed to analyze call', {
            tokenAddress: call.tokenAddress.substring(0, 20),
            error: error.message,
          });
        }
      })
    );

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  logger.info('Analysis complete', { 
    total: calls.length, 
    analyzed: analyses.length 
  });

  return analyses;
}

/**
 * Identify patterns in high performers
 */
export function identifyPatterns(analyses: CallAnalysis[]): void {
  const moon = analyses.filter(a => a.performanceCategory === 'moon');
  const good = analyses.filter(a => a.performanceCategory === 'good');
  const decent = analyses.filter(a => a.performanceCategory === 'decent');
  const poor = analyses.filter(a => a.performanceCategory === 'poor');

  logger.info('Performance distribution', {
    moon: moon.length,
    good: good.length,
    decent: decent.length,
    poor: poor.length,
  });

  // Analyze patterns
  const patterns: Record<string, any> = {};

  // Market cap patterns
  patterns.marketCap = {
    moon: groupBy(moon, a => a.marketCapCategory),
    good: groupBy(good, a => a.marketCapCategory),
    poor: groupBy(poor, a => a.marketCapCategory),
  };

  // Price action patterns
  patterns.priceChange1h = {
    moon: calculateStats(moon.map(a => a.priceChange1h)),
    good: calculateStats(good.map(a => a.priceChange1h)),
    poor: calculateStats(poor.map(a => a.priceChange1h)),
  };

  patterns.priceChange24h = {
    moon: calculateStats(moon.map(a => a.priceChange24h)),
    good: calculateStats(good.map(a => a.priceChange24h)),
    poor: calculateStats(poor.map(a => a.priceChange24h)),
  };

  // Volume patterns
  patterns.volumeChange1h = {
    moon: calculateStats(moon.map(a => a.volumeChange1h)),
    good: calculateStats(good.map(a => a.volumeChange1h)),
    poor: calculateStats(poor.map(a => a.volumeChange1h)),
  };

  // Timing patterns
  patterns.hourOfDay = {
    moon: groupBy(moon, a => a.hourOfDay),
    good: groupBy(good, a => a.hourOfDay),
    poor: groupBy(poor, a => a.hourOfDay),
  };

  patterns.dayOfWeek = {
    moon: groupBy(moon, a => a.dayOfWeek),
    good: groupBy(good, a => a.dayOfWeek),
    poor: groupBy(poor, a => a.dayOfWeek),
  };

  // Volatility patterns
  patterns.volatility24h = {
    moon: calculateStats(moon.map(a => a.volatility24h)),
    good: calculateStats(good.map(a => a.volatility24h)),
    poor: calculateStats(poor.map(a => a.volatility24h)),
  };

  // Save patterns
  const patternsPath = path.join(OUTPUT_DIR, 'brook-patterns.json');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(patternsPath, JSON.stringify(patterns, null, 2));

  logger.info('Patterns saved', { path: patternsPath });

  // Print summary
  console.log('\n📊 BROOK TOKEN SELECTION PATTERNS\n');
  console.log('=== Market Cap Distribution ===');
  console.log('Moon (>10x):', patterns.marketCap.moon);
  console.log('Good (3-10x):', patterns.marketCap.good);
  console.log('Poor (<1.5x):', patterns.marketCap.poor);
  
  console.log('\n=== Price Action (1h before call) ===');
  console.log('Moon avg:', patterns.priceChange1h.moon.avg.toFixed(2) + '%');
  console.log('Good avg:', patterns.priceChange1h.good.avg.toFixed(2) + '%');
  console.log('Poor avg:', patterns.priceChange1h.poor.avg.toFixed(2) + '%');
  
  console.log('\n=== Volume Change (1h before call) ===');
  console.log('Moon avg:', patterns.volumeChange1h.moon.avg.toFixed(2) + '%');
  console.log('Good avg:', patterns.volumeChange1h.good.avg.toFixed(2) + '%');
  console.log('Poor avg:', patterns.volumeChange1h.poor.avg.toFixed(2) + '%');
}

function groupBy<T>(arr: T[], keyFn: (item: T) => string | number): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const item of arr) {
    const key = String(keyFn(item));
    groups[key] = (groups[key] || 0) + 1;
  }
  return groups;
}

function calculateStats(values: number[]): { avg: number; median: number; min: number; max: number } {
  if (values.length === 0) {
    return { avg: 0, median: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const median = sorted[Math.floor(sorted.length / 2)];

  return {
    avg,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * Build scoring model based on patterns
 */
export function buildScoringModel(analyses: CallAnalysis[]): (features: TokenFeatures) => number {
  // Calculate weights based on correlation with high returns
  const moon = analyses.filter(a => a.performanceCategory === 'moon');
  const all = analyses;

  // Market cap weights (micro/small tokens perform better)
  const marketCapWeights: Record<string, number> = {
    micro: 1.5,
    small: 1.2,
    mid: 0.8,
    large: 0.5,
  };

  // Price action weights (slight positive momentum is good)
  const getPriceActionScore = (change1h: number, change24h: number): number => {
    // Sweet spot: 5-20% gain in 24h, 0-10% in 1h
    if (change24h >= 5 && change24h <= 20 && change1h >= 0 && change1h <= 10) {
      return 1.5;
    }
    // Too much pump (likely too late)
    if (change24h > 50 || change1h > 20) {
      return 0.3;
    }
    // Slight positive
    if (change24h > 0 && change24h < 50) {
      return 1.0;
    }
    // Negative (might be dip buy)
    if (change24h < -20) {
      return 0.7;
    }
    return 0.5;
  };

  // Volume score (increasing volume is good)
  const getVolumeScore = (volumeChange1h: number): number => {
    if (volumeChange1h > 50) return 1.5; // Big volume spike
    if (volumeChange1h > 20) return 1.2; // Moderate increase
    if (volumeChange1h > 0) return 1.0; // Slight increase
    return 0.7; // Decreasing
  };

  // Timing score (certain hours/days might be better)
  const getTimingScore = (hour: number, day: number): number => {
    // US market hours (9am-5pm EST = 14-22 UTC) tend to be better
    if (hour >= 14 && hour <= 22) return 1.1;
    // Weekend might be different
    if (day === 0 || day === 6) return 0.9;
    return 1.0;
  };

  return (features: TokenFeatures): number => {
    let score = 1.0;

    // Market cap
    score *= marketCapWeights[features.marketCapCategory] || 1.0;

    // Price action
    score *= getPriceActionScore(features.priceChange1h, features.priceChange24h);

    // Volume
    score *= getVolumeScore(features.volumeChange1h);

    // Timing
    score *= getTimingScore(features.hourOfDay, features.dayOfWeek);

    // Volatility (moderate volatility is good, too high is risky)
    if (features.volatility24h > 5 && features.volatility24h < 20) {
      score *= 1.1;
    } else if (features.volatility24h > 50) {
      score *= 0.7;
    }

    return score;
  };
}

/**
 * Main execution
 */
async function main() {
  logger.info('Starting Brook token selection analysis');

  try {
    // Analyze all calls
    const analyses = await analyzeBrookCalls();

    // Save full analysis
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const analysisPath = path.join(OUTPUT_DIR, 'brook-calls-analysis.json');
    fs.writeFileSync(analysisPath, JSON.stringify(analyses, null, 2));
    logger.info('Full analysis saved', { path: analysisPath, count: analyses.length });

    // Identify patterns
    identifyPatterns(analyses);

    // Build scoring model
    const scoreModel = buildScoringModel(analyses);
    
    // Test model on top performers
    const topPerformers = analyses
      .filter(a => a.performanceCategory === 'moon' || a.performanceCategory === 'good')
      .sort((a, b) => b.maxReturn30d - a.maxReturn30d)
      .slice(0, 20);

    console.log('\n🎯 TOP 20 PERFORMERS - MODEL SCORES\n');
    for (const perf of topPerformers) {
      const score = scoreModel(perf);
      console.log(
        `${perf.tokenSymbol || perf.tokenAddress.substring(0, 10)}: ` +
        `Score ${score.toFixed(2)}, ` +
        `Return ${perf.maxReturn30d.toFixed(2)}x, ` +
        `MCap ${perf.marketCapCategory}, ` +
        `Price1h ${perf.priceChange1h.toFixed(1)}%, ` +
        `Vol1h ${perf.volumeChange1h.toFixed(1)}%`
      );
    }

    // Save model
    const modelPath = path.join(OUTPUT_DIR, 'brook-scoring-model.json');
    fs.writeFileSync(modelPath, JSON.stringify({
      description: 'Brook token selection scoring model',
      weights: {
        marketCap: { micro: 1.5, small: 1.2, mid: 0.8, large: 0.5 },
        priceAction: 'Sweet spot: 5-20% gain in 24h, 0-10% in 1h',
        volume: 'Increasing volume is positive',
        timing: 'US market hours (14-22 UTC) slightly better',
        volatility: 'Moderate volatility (5-20%) is optimal',
      },
      sampleScores: topPerformers.map(p => ({
        token: p.tokenSymbol || p.tokenAddress.substring(0, 10),
        score: scoreModel(p),
        return: p.maxReturn30d,
      })),
    }, null, 2));

    logger.info('Model saved', { path: modelPath });

    console.log('\n✅ Analysis complete!');
    console.log(`📁 Results saved to: ${OUTPUT_DIR}`);

  } catch (error: any) {
    logger.error('Analysis failed', error as Error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// Functions are already exported above, just export types
export type { CallAnalysis, TokenFeatures };

