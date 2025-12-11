
/**
 * Deep Dive Analysis of Brook's Winning Token Selections
 *
 * This script isolates Brook's most profitable calls ("moon" and "good" performers)
 * and performs a detailed feature analysis to uncover the real common denominators
 * that lead to high returns. The findings from this script will be used to build
 * the V2 scoring model.
 */
import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../src/utils/logger';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { getEntryMcapWithFallback } from '../../packages/web/lib/services/mcap-calculator';

// --- Functions consolidated from score-and-analyze-unified-calls.ts ---

interface UnifiedCall {
  id?: number;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  callerName: string;
  callTimestamp: number;
  priceAtAlert?: number;
  entryMcap?: number;
  messageText?: string;
}

async function getAllCalls(): Promise<UnifiedCall[]> {
  const dbPath = path.join(process.cwd(), 'data', 'unified_calls.db');
  if (!fs.existsSync(dbPath)) {
    logger.error('Unified calls database not found.', { path: dbPath });
    return [];
  }
  const db = new Database(dbPath);
  const allAsync = promisify(db.all.bind(db));

  try {
    const rows = await allAsync("SELECT * FROM unified_calls ORDER BY call_timestamp ASC");
    return (rows as any[]).map(row => ({
      ...row,
      callerName: row.caller_name, // Corrected from callerName
      callTimestamp: row.call_timestamp,
    }));
  } finally {
    db.close();
  }
}

async function fetchCandlesForAnalysis(
  tokenAddress: string,
  callUnix: number,
  chain: string = 'solana'
): Promise<Array<{ timestamp: number; price: number; volume: number }>> {
  const startTime = DateTime.fromSeconds(callUnix - 86400 * 2); // 2 days before
  const endTime = DateTime.fromSeconds(callUnix + 2592000); // 30 days after

  logger.info('--- ENTERING fetchCandlesForAnalysis ---', {
    tokenAddress,
    callUnix,
    chain,
    start: startTime.toISO(),
    end: endTime.toISO(),
  });

  try {
    const birdeyeData = await birdeyeClient.fetchOHLCVData(
      tokenAddress,
      startTime.toJSDate(),
      endTime.toJSDate(),
      '5m'
    );
    
    logger.info('--- BIRDEYE RESPONSE ---', { 
      token: tokenAddress,
      hasData: !!birdeyeData,
      hasItems: !!birdeyeData?.items,
      itemCount: birdeyeData?.items?.length || 0,
    });

    if (!birdeyeData || !birdeyeData.items) {
      logger.warn('Birdeye data or items are null/undefined. Returning empty array.', { tokenAddress });
      return [];
    }

    const mappedCandles = birdeyeData.items.map((item: any) => ({
      timestamp: item.unixTime,
      price: typeof item.close === 'string' ? parseFloat(item.close) : (item.close || 0),
      volume: typeof item.volume === 'string' ? parseFloat(item.volume) : (item.volume || 0),
    }));

    logger.info('--- LEAVING fetchCandlesForAnalysis ---', { tokenAddress, returnedCandles: mappedCandles.length });
    return mappedCandles;

  } catch (error: any) {
    logger.error('--- CRITICAL ERROR in fetchCandlesForAnalysis ---', { 
      tokenAddress: tokenAddress, 
      error: error.message,
      stack: error.stack,
      response: error.response?.data,
    });
    return [];
  }
}

function calculateReturns(
  callPrice: number,
  candles: Array<{ timestamp: number; price: number; volume: number }>,
  callUnix: number,
  entryMcap?: number
): any { // Return type simplified
  const candlesAfter = candles.filter(c => c.timestamp > callUnix);
  
  const candles7d = candlesAfter.filter(c => c.timestamp <= callUnix + 604800); // 7 days
  const candles30d = candlesAfter.filter(c => c.timestamp <= callUnix + 2592000); // 30 days

  const maxPrice7d = candles7d.length > 0 ? Math.max(...candles7d.map(c => c.price)) : callPrice;
  const maxPrice30d = candles30d.length > 0 ? Math.max(...candles30d.map(c => c.price)) : callPrice;

  const priceAt7d = candles7d.length > 0 ? candles7d[candles7d.length - 1]?.price || callPrice : callPrice;
  const priceAt30d = candles30d.length > 0 ? candles30d[candles30d.length - 1]?.price || callPrice : callPrice;

  const maxReturn7d = callPrice > 0 ? maxPrice7d / callPrice : 0;
  const maxReturn30d = callPrice > 0 ? maxPrice30d / callPrice : 0;
  
  logger.debug('Calculated returns', {
    callPrice,
    maxPrice30d,
    maxReturn30d
  });

  return { maxReturn30d, maxReturn7d };
}


// --------------------------------------------------------------------

config();

// Extends V1 features with more detailed pre-call and post-call metrics
interface DeepDiveFeatures {
  // Pre-call momentum at finer granularity
  priceChange5m: number;
  priceChange15m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  
  // Dip-and-Rip indicators
  isPostDip: boolean; // Was there a significant dip (>30%) before the call?
  dipDepth: number;   // How deep was the dip from the prior peak?
  timeSinceDip: number; // Hours since the dip's trough
  recoveryFromDip: number; // % recovery from the trough to the call price
  
  // Consolidation indicators
  isConsolidating: boolean; // Trading in a tight range before the call?
  consolidationRange: number; // % range of consolidation
  consolidationDuration: number; // Hours in consolidation
  
  // Volume Profile
  volume5m: number;
  volume1h: number;
  volume24h: number;
  volumeSpikeFactor: number; // How much has volume spiked recently vs average?
  
  // Token Age
  tokenAgeHours?: number;
  
  // Market Cap
  marketCap: number;
}

interface WinnerAnalysis {
  tokenAddress: string;
  tokenSymbol?: string;
  callTimestamp: Date;
  performanceCategory: 'moon' | 'good';
  maxReturn30d: number;
  features: DeepDiveFeatures;
}

const OUTPUT_DIR = path.join(process.cwd(), 'data/exports/brook-analysis');

/**
 * Main function to perform deep-dive analysis on Brook's winners
 */
async function analyzeBrookWinners() {
  logger.info("Starting deep dive analysis on Brook's winning calls...");

  // 1. Get all calls and filter for Brook
  const allCalls = await getAllCalls();
  const brookCalls = allCalls.filter(call => call.callerName?.toLowerCase().includes('brook'));
  logger.info(`Found ${brookCalls.length} total calls from Brook.`);

  const winners: WinnerAnalysis[] = [];
  let processed = 0;

  logger.info(`Found ${brookCalls.length} total calls from Brook to process.`);

  for (const call of brookCalls) {
    processed++;
    if (processed % 10 === 0) {
      logger.info(`--- Processing call ${processed}/${brookCalls.length} ---`);
    }

    if (!call.tokenAddress) {
      continue; // Skip calls with no token address
    }

    const candles = await fetchCandlesForAnalysis(call.tokenAddress, call.callTimestamp, call.chain);
    if (candles.length < 20) { // Need enough data for analysis
      logger.debug('Not enough candles, skipping', { token: call.tokenAddress });
      continue;
    }

    const returns = calculateReturns(
      call.priceAtAlert || candles.find(c => c.timestamp >= call.callTimestamp)?.price || 0,
      candles,
      call.callTimestamp,
      call.entryMcap
    );

    const performanceCategory = categorizePerformance(returns.maxReturn30d);
    
    if (performanceCategory === 'moon' || performanceCategory === 'good') {
      const features = await extractDeepDiveFeatures(call, candles);
      if (features) {
        winners.push({
          tokenAddress: call.tokenAddress,
          tokenSymbol: call.tokenSymbol,
          callTimestamp: new Date(call.callTimestamp * 1000),
          performanceCategory,
          maxReturn30d: returns.maxReturn30d,
          features,
        });
      }
    } else {
      logger.debug('Skipping low-performing call', { 
        token: call.tokenAddress.substring(0, 10), 
        maxReturn: returns.maxReturn30d.toFixed(2)
      });
    }
  }
  
  logger.info(`Identified ${winners.length} high-performing calls from Brook for analysis.`);
  
  // 4. Aggregate and analyze the features of the winners
  if (winners.length > 0) {
    const featureSummary = aggregateWinnerFeatures(winners);
    
    // 5. Save and print the findings
    const outputPath = path.join(OUTPUT_DIR, 'brook-winner-fingerprint.json');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify({
      totalWinnersAnalyzed: winners.length,
      featureSummary,
      rawWinners: winners,
    }, null, 2));

    logger.info(`Winner fingerprint saved to ${outputPath}`);
    printSummary(featureSummary);
  } else {
    logger.warn('No high-performing calls found for Brook to analyze.');
  }
}

/**
 * Placeholder for deep feature extraction.
 */
async function extractDeepDiveFeatures(call: UnifiedCall, candles: Array<{ timestamp: number; price: number; volume: number }>): Promise<DeepDiveFeatures | null> {
  const callUnix = call.callTimestamp;
  const candlesBefore = candles.filter(c => c.timestamp < callUnix).sort((a, b) => a.timestamp - b.timestamp);

  if (candlesBefore.length < 12) { // At least 1 hour of data
    return null;
  }

  const callPrice = call.priceAtAlert || candles.find(c => c.timestamp >= callUnix)?.price;
  if (!callPrice) return null;

  // --- Pre-call momentum ---
  const getPriceAt = (secsAgo: number) => candlesBefore.find(c => c.timestamp >= callUnix - secsAgo)?.price;
  const price5m = getPriceAt(300);
  const price15m = getPriceAt(900);
  const price1h = getPriceAt(3600);
  const price6h = getPriceAt(21600);
  const price24h = getPriceAt(86400);

  const priceChange5m = price5m ? ((callPrice - price5m) / price5m) * 100 : 0;
  const priceChange15m = price15m ? ((callPrice - price15m) / price15m) * 100 : 0;
  const priceChange1h = price1h ? ((callPrice - price1h) / price1h) * 100 : 0;
  const priceChange6h = price6h ? ((callPrice - price6h) / price6h) * 100 : 0;
  const priceChange24h = price24h ? ((callPrice - price24h) / price24h) * 100 : 0;
  
  // --- Dip-and-Rip indicators (looking at 24h before call) ---
  const candles24h = candlesBefore.filter(c => c.timestamp >= callUnix - 86400);
  let isPostDip = false, dipDepth = 0, timeSinceDip = 0, recoveryFromDip = 0;

  if (candles24h.length > 20) {
    const peak24h = candles24h.reduce((max, c) => c.price > max.price ? c : max, candles24h[0]);
    const candlesAfterPeak = candles24h.filter(c => c.timestamp > peak24h.timestamp);

    if (candlesAfterPeak.length > 5) {
      const troughAfterPeak = candlesAfterPeak.reduce((min, c) => c.price < min.price ? c : min, candlesAfterPeak[0]);
      const localDipDepth = (peak24h.price - troughAfterPeak.price) / peak24h.price;

      if (localDipDepth > 0.3) { // Significant dip happened
        isPostDip = true;
        dipDepth = localDipDepth;
        timeSinceDip = (callUnix - troughAfterPeak.timestamp) / 3600; // in hours
        recoveryFromDip = (callPrice - troughAfterPeak.price) / troughAfterPeak.price * 100;
      }
    }
  }

  // --- Consolidation indicators (looking at 6h before call) ---
  const candles6h = candlesBefore.filter(c => c.timestamp >= callUnix - 21600);
  let isConsolidating = false, consolidationRange = 0, consolidationDuration = 0;

  if (candles6h.length > 30) {
      const maxPrice6h = Math.max(...candles6h.map(c => c.price));
      const minPrice6h = Math.min(...candles6h.map(c => c.price));
      const range = (maxPrice6h - minPrice6h) / (maxPrice6h || 1);

      if (range < 0.2) { // Price variation is less than 20%
          isConsolidating = true;
          consolidationRange = range;
          consolidationDuration = 6; // Fixed for now
      }
  }

  // --- Volume Profile ---
  const getVolumeSum = (secsAgo: number) => candlesBefore.filter(c => c.timestamp >= callUnix - secsAgo).reduce((sum, c) => sum + c.volume, 0);
  const volume5m = getVolumeSum(300);
  const volume1h = getVolumeSum(3600);
  const volume24h = getVolumeSum(86400);
  const avgVolume24h = volume24h / (candles24h.length || 1);
  const volumeSpikeFactor = avgVolume24h > 0 ? volume1h / (avgVolume24h * (3600/86400)) : 0;
  
  // --- Market Cap ---
  const marketCap = await getEntryMcapWithFallback(
    call.tokenAddress, 
    call.chain, 
    new Date(call.callTimestamp * 1000), 
    callPrice, 
    call.messageText || ''
  );

  return {
    priceChange5m, priceChange15m, priceChange1h, priceChange6h, priceChange24h,
    isPostDip, dipDepth, timeSinceDip, recoveryFromDip,
    isConsolidating, consolidationRange, consolidationDuration,
    volume5m, volume1h, volume24h, volumeSpikeFactor,
    marketCap: marketCap || 0,
  };
}

/**
 * Aggregates winner features to find patterns.
 */
function aggregateWinnerFeatures(winners: WinnerAnalysis[]): any {
  const featureValues: Record<keyof Omit<DeepDiveFeatures, 'tokenAgeHours'>, number[]> = {
    priceChange5m: [], priceChange15m: [], priceChange1h: [], priceChange6h: [], priceChange24h: [],
    dipDepth: [], timeSinceDip: [], recoveryFromDip: [],
    consolidationRange: [], consolidationDuration: [],
    volume5m: [], volume1h: [], volume24h: [], volumeSpikeFactor: [], marketCap: [],
    isPostDip: [], isConsolidating: [] // Will be treated as booleans
  };

  for (const winner of winners) {
    for (const key in featureValues) {
      if (key in winner.features) {
        featureValues[key as keyof typeof featureValues].push(winner.features[key as keyof DeepDiveFeatures] as number);
      }
    }
  }

  const stats: any = {};
  for (const key in featureValues) {
    const values = featureValues[key as keyof typeof featureValues];
    if (key === 'isPostDip' || key === 'isConsolidating') {
      stats[key] = {
        prevalence: (values.filter(v => v).length / values.length) * 100
      };
    } else if (values.length > 0) {
      const sorted = [...values].sort((a, b) => a - b);
      stats[key] = {
        avg: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
        median: sorted[Math.floor(sorted.length / 2)],
        p25: sorted[Math.floor(sorted.length * 0.25)],
        p75: sorted[Math.floor(sorted.length * 0.75)],
        min: sorted[0],
        max: sorted[sorted.length - 1],
      };
    }
  }
  return stats;
}

/**
 * Prints a human-readable summary of the winner fingerprint.
 */
function printSummary(summary: any) {
  console.log("\n--- Brook's Winner Fingerprint ---\n");
  console.log("This is the DNA of Brook's most successful calls (>3x returns).\n");

  const formatNum = (n: number) => (n || 0).toFixed(2);
  
  console.log("📈 Pre-Call Momentum:");
  console.log(`   - 1h before call: ${formatNum(summary.priceChange1h.avg)}% (avg)`);
  console.log(`   - 6h before call: ${formatNum(summary.priceChange6h.avg)}% (avg)`);

  console.log("\n📉 Dip-and-Rip Pattern:");
  console.log(`   - Prevalence: ${formatNum(summary.isPostDip.prevalence)}% of winners were called after a recent dip.`);
  console.log(`   - Dip Depth: The average dip was ${formatNum(summary.dipDepth.avg * 100)}% from the peak.`);
  console.log(`   - Recovery: Winners were called after recovering an average of ${formatNum(summary.recoveryFromDip.avg)}% from the bottom.`);

  console.log("\n sideways Consolidation:");
  console.log(`   - Prevalence: ${formatNum(summary.isConsolidating.prevalence)}% of winners were consolidating before the call.`);
  console.log(`   - Tightness: The average consolidation range was ${formatNum(summary.consolidationRange.avg * 100)}%.`);
  
  console.log("\n📊 Volume Profile:");
  console.log(`   - Spike Factor: Volume in the hour before the call was, on average, ${formatNum(summary.volumeSpikeFactor.avg)}x the daily average.`);

  console.log("\n💰 Market Cap:");
  console.log(`   - Sweet Spot: The median market cap was $${(summary.marketCap.median / 1000).toFixed(2)}K.`);
  
  console.log("\n-----------------------------------\n");
}

function categorizePerformance(maxReturn30d: number): 'moon' | 'good' | 'decent' | 'poor' {
  if (maxReturn30d >= 10) return 'moon';
  if (maxReturn30d >= 3) return 'good';
  if (maxReturn30d >= 1.5) return 'decent';
  return 'poor';
}


main().catch(err => {
  logger.error("Deep dive analysis failed", { error: err, stack: err.stack });
  process.exit(1);
});

async function main() {
    await analyzeBrookWinners();
}
