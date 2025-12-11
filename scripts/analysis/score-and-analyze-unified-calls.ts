/**
 * Score all tokens in unified calls table and analyze P&L for high-scoring tokens
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../src/utils/logger';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { getEntryMcapWithFallback } from '../../src/lib/services/mcap-calculator';

config();

export interface UnifiedCall {
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

export interface ScoredCall extends UnifiedCall {
  score: number;
  returns: {
    maxReturn7d: number;
    maxReturn30d: number;
    returnAt7d: number;
    returnAt30d: number;
  };
  features: any; // Simplified for now
}

export interface ReturnData {
  maxReturn7d: number;
  maxReturn30d: number;
  returnAt7d: number;
  returnAt30d: number;
  maxMcap7d?: number;
  maxMcap30d?: number;
  mcapAt7d?: number;
  mcapAt30d?: number;
}

export async function getAllCalls(): Promise<UnifiedCall[]> {
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
      callTimestamp: row.call_timestamp,
    }));
  } finally {
    db.close();
  }
}

export async function fetchCandlesForAnalysis(
  tokenAddress: string,
  callUnix: number,
  chain: string = 'solana'
): Promise<Array<{ timestamp: number; price: number; volume: number }>> {
  const startTime = DateTime.fromSeconds(callUnix - 86400 * 2); // 2 days before
  const endTime = DateTime.fromSeconds(callUnix + 2592000); // 30 days after

  try {
    const birdeyeData = await birdeyeClient.fetchOHLCVData(
      tokenAddress,
      startTime.toJSDate(),
      endTime.toJSDate(),
      '5m'
    );

    if (!birdeyeData || !birdeyeData.items) {
      return [];
    }

    return birdeyeData.items.map((item: any) => ({
      timestamp: item.unixTime,
      price: typeof item.close === 'string' ? parseFloat(item.close) : (item.close || 0),
      volume: typeof item.volume === 'string' ? parseFloat(item.volume) : (item.volume || 0),
    }));
  } catch (error: any) {
    logger.debug('Failed to fetch candles', { tokenAddress: tokenAddress.substring(0, 10), error: error.message });
    return [];
  }
}

export function calculateReturns(
  callPrice: number,
  candles: Array<{ timestamp: number; price: number; volume: number }>,
  callUnix: number,
  entryMcap?: number
): ReturnData {
  const candlesAfter = candles.filter(c => c.timestamp > callUnix);
  
  const candles7d = candlesAfter.filter(c => c.timestamp <= callUnix + 604800); // 7 days
  const candles30d = candlesAfter.filter(c => c.timestamp <= callUnix + 2592000); // 30 days

  const maxPrice7d = candles7d.length > 0 ? Math.max(...candles7d.map(c => c.price)) : callPrice;
  const maxPrice30d = candles30d.length > 0 ? Math.max(...candles30d.map(c => c.price)) : callPrice;

  const priceAt7d = candles7d.length > 0 ? candles7d[candles7d.length - 1]?.price || callPrice : callPrice;
  const priceAt30d = candles30d.length > 0 ? candles30d[candles30d.length - 1]?.price || callPrice : callPrice;

  const priceMultiple7d = callPrice > 0 ? maxPrice7d / callPrice : 0;
  const priceMultiple30d = callPrice > 0 ? maxPrice30d / callPrice : 0;
  const priceMultipleAt7d = callPrice > 0 ? priceAt7d / callPrice : 0;
  const priceMultipleAt30d = callPrice > 0 ? priceAt30d / callPrice : 0;

  const result: ReturnData = {
    maxReturn7d: priceMultiple7d,
    maxReturn30d: priceMultiple30d,
    returnAt7d: priceMultipleAt7d,
    returnAt30d: priceMultipleAt30d,
  };

  if (entryMcap && callPrice > 0) {
    result.maxMcap7d = entryMcap * priceMultiple7d;
    result.maxMcap30d = entryMcap * priceMultiple30d;
    result.mcapAt7d = entryMcap * priceMultipleAt7d;
    result.mcapAt30d = entryMcap * priceMultipleAt30d;
  }

  return result;
}

export function categorizePerformance(maxReturn30d: number): 'moon' | 'good' | 'decent' | 'poor' {
  if (maxReturn30d >= 10) return 'moon';
  if (maxReturn30d >= 3) return 'good';
  if (maxReturn30d >= 1.5) return 'decent';
  return 'poor';
}

/**
 * Score and analyze all calls
 */
async function scoreAndAnalyzeCalls(
  calls: UnifiedCall[],
  scoreModel: (features: any) => number
): Promise<ScoredCall[]> {
  const scoredCalls: ScoredCall[] = [];
  const batchSize = 5;
  let processed = 0;

  logger.info('Scoring and analyzing calls', { total: calls.length });

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
          logger.debug('Fetching candles for token', {
            tokenAddress: call.tokenAddress.substring(0, 30),
            chain: call.chain,
            callTimestamp: new Date(call.callTimestamp * 1000).toISOString(),
            caller: call.callerName,
          });

          const candles = await fetchCandlesForAnalysis(
            call.tokenAddress,
            call.callTimestamp,
            call.chain
          );

          if (candles.length === 0) {
            logger.debug('No candles found, skipping', {
              tokenAddress: call.tokenAddress.substring(0, 30),
              chain: call.chain,
              callTimestamp: new Date(call.callTimestamp * 1000).toISOString(),
              caller: call.callerName,
            });
            return;
          }

          logger.info('✅ Fetched candles for scoring', {
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
          const scoredCall: ScoredCall = {
            ...call,
            score,
            returns,
            features,
          };

          scoredCalls.push(scoredCall);
        } catch (error: any) {
          logger.warn('Failed to score call', {
            tokenAddress: call.tokenAddress.substring(0, 20),
            error: error.message,
          });
        }
      })
    );

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  logger.info('Scoring complete', {
    total: calls.length,
    scored: scoredCalls.length,
  });

  return scoredCalls;
}

/**
 * Analyze P&L by score ranges
 */
function analyzePnLByScore(scoredCalls: ScoredCall[]): void {
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
    let filtered: ScoredCall[];
    
    if (range.name === 'Bottom 50%') {
      const threshold = scoredCalls[Math.floor(scoredCalls.length * 0.5)]?.score || 0;
      filtered = scoredCalls.filter(c => c.score <= threshold);
    } else {
      const threshold = scoredCalls[Math.floor(scoredCalls.length * (1 - range.threshold))]?.score || 0;
      filtered = scoredCalls.filter(c => c.score >= threshold);
    }

    if (filtered.length === 0) continue;

    const avgReturn30d = filtered.reduce((sum, c) => sum + c.returns.maxReturn30d, 0) / filtered.length;
    const avgReturn7d = filtered.reduce((sum, c) => sum + c.returns.maxReturn7d, 0) / filtered.length;
    const medianReturn30d = [...filtered].sort((a, b) => a.returns.maxReturn30d - b.returns.maxReturn30d)[Math.floor(filtered.length / 2)]?.returns.maxReturn30d || 0;
    
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
    console.log(
      `${(call.tokenSymbol || call.tokenAddress.substring(0, 15)).padEnd(20)} ` +
      `Score: ${call.score.toFixed(2).padStart(6)} | ` +
      `30d Max: ${call.returns.maxReturn30d.toFixed(2)}x | ` +
      `Category: ${call.performanceCategory.padEnd(6)} | ` +
      `Caller: ${call.callerName.substring(0, 20)}`
    );
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const limit = args[0] ? parseInt(args[0], 10) : undefined;

  logger.info('Starting unified calls scoring and analysis', { limit });

  try {
    // Get all calls
    const allCalls = await getAllCalls();
    
    // Filter out calls with invalid timestamps (before 2020-01-01 = 1577836800)
    // Also filter out calls with timestamp = 1 or 2 (obviously invalid)
    const validCalls = allCalls.filter(call => 
      call.callTimestamp > 1577836800 && call.callTimestamp < 2000000000
    );
    const invalidCount = allCalls.length - validCalls.length;
    
    if (invalidCount > 0) {
      logger.warn('Filtered out calls with invalid timestamps', {
        total: allCalls.length,
        valid: validCalls.length,
        invalid: invalidCount,
      });
    }
    
    logger.info('Loaded calls', { count: validCalls.length });

    // Build scoring model (weights are hardcoded, so we can use empty array)
    const scoreModel = buildScoringModel([]);

    // Score and analyze
    const scoredCalls = await scoreAndAnalyzeCalls(validCalls, scoreModel);

    // Analyze P&L (only if we have scored calls)
    if (scoredCalls.length > 0) {
      analyzePnLByScore(scoredCalls);
    } else {
      logger.warn('No calls were successfully scored');
    }

    // Save results
    const outputDir = path.join(process.cwd(), 'data/exports/brook-analysis');
    fs.mkdirSync(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `unified-calls-scored-${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(scoredCalls, null, 2));

    // Save summary
    const summary = {
      totalCalls: validCalls.length,
      scoredCalls: scoredCalls.length,
      top10Percent: {
        count: Math.floor(scoredCalls.length * 0.1),
        avgReturn30d: scoredCalls
          .slice(0, Math.floor(scoredCalls.length * 0.1))
          .reduce((sum, c) => sum + c.returns.maxReturn30d, 0) / Math.floor(scoredCalls.length * 0.1),
      },
      top25Percent: {
        count: Math.floor(scoredCalls.length * 0.25),
        avgReturn30d: scoredCalls
          .slice(0, Math.floor(scoredCalls.length * 0.25))
          .reduce((sum, c) => sum + c.returns.maxReturn30d, 0) / Math.floor(scoredCalls.length * 0.25),
      },
    };

    const summaryPath = path.join(outputDir, `unified-calls-summary-${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

    logger.info('Analysis complete', {
      outputPath,
      summaryPath,
    });

    console.log(`\n✅ Results saved to: ${outputPath}`);
    console.log(`📊 Summary saved to: ${summaryPath}`);
  } catch (error: any) {
    logger.error('Analysis failed', error as Error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { scoreAndAnalyzeCalls, analyzePnLByScore };

