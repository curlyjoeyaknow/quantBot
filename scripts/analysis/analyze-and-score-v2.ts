
/**
 * V2 Analysis Script: Implements a more sophisticated scoring model based on
 * the "Dip-and-Rip" strategy.
 *
 * Strategy:
 * 1. Initial Run-up: Token shows strength (e.g., >2x from alert).
 * 2. Major Dip: Price pulls back significantly (e.g., >50% from peak).
 * 3. Recovery Confirmation: Price bounces off the bottom (e.g., 10-20% retracement).
 *
 * This script identifies tokens matching this pattern.
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { logger } from '../../src/utils/logger';
import { CallAnalysis, TokenFeatures } from './analyze-brook-token-selection'; // Reuse types

config();

// V2 Features - Includes Dip-and-Rip metrics
export interface TokenFeaturesV2 extends TokenFeatures {
  // Dip-and-Rip Features
  peakPrice7d: number;
  peakPrice30d: number;
  troughAfterPeak7d: number;
  dipPercentage: number; // (peak - trough) / peak
  retracementFromTrough: number; // (current - trough) / trough
  isInDipBuyZone: boolean;
}

export interface CallAnalysisV2 extends CallAnalysis {
  features: TokenFeaturesV2;
}


/**
 * Extracts V2 features, including the "Dip-and-Rip" pattern.
 */
export async function extractFeaturesV2(
  call: { tokenAddress: string; alertTimestamp: Date; chain: string; priceAtAlert?: number },
  candles: Array<{ timestamp: number; price: number; volume: number }>
): Promise<TokenFeaturesV2 | null> {
  const callUnix = Math.floor(call.alertTimestamp.getTime() / 1000);
  const callPrice = call.priceAtAlert || candles.find(c => c.timestamp >= callUnix)?.price;

  if (!callPrice || callPrice === 0) {
    return null;
  }
  
  const baseFeatures = {} as any; // Simplified for now, will reuse from V1 later
  
  // -- Start of Dip-and-Rip Feature Extraction --

  const candlesAfter = candles.filter(c => c.timestamp > callUnix);
  const candles7d = candlesAfter.filter(c => c.timestamp <= callUnix + 604800);

  if (candles7d.length < 10) { // Need sufficient data
    return null;
  }

  // 1. Find initial peak
  const peak7d = candles7d.reduce((max, c) => c.price > max.price ? c : max, candles7d[0]);
  const initialRunUpMultiple = peak7d.price / callPrice;

  let isInDipBuyZone = false;
  let dipPercentage = 0;
  let retracementFromTrough = 0;
  let troughAfterPeak7d = 0;

  // 2. Check for Major Dip (if initial run-up was sufficient)
  if (initialRunUpMultiple >= 2) {
    const candlesAfterPeak = candles7d.filter(c => c.timestamp > peak7d.timestamp);
    
    if (candlesAfterPeak.length > 5) {
      const trough = candlesAfterPeak.reduce((min, c) => c.price < min.price ? c : min, candlesAfterPeak[0]);
      troughAfterPeak7d = trough.price;
      dipPercentage = (peak7d.price - trough.price) / peak7d.price;

      // 3. Check for Recovery
      if (dipPercentage >= 0.5) {
        const currentPrice = candlesAfterPeak[candlesAfterPeak.length - 1].price;
        retracementFromTrough = (currentPrice - trough.price) / trough.price;
        
        // Condition: Retraced 10-20% from the bottom
        if (retracementFromTrough >= 0.1 && retracementFromTrough <= 0.2) {
          isInDipBuyZone = true;
        }
      }
    }
  }

  return {
    ...baseFeatures, // We'll populate this later
    price: callPrice,
    volume: 0,
    marketCap: 0,
    priceChange1h: 0,
    priceChange24h: 0,
    priceChange15m: 0,
    volumeChange1h: 0,
    avgVolume24h: 0,
    hourOfDay: 0,
    dayOfWeek: 0,
    isWeekend: false,
    volatility24h: 0,
    marketCapCategory: 'micro',

    // V2 Features
    peakPrice7d: peak7d.price,
    peakPrice30d: 0, // Placeholder
    troughAfterPeak7d,
    dipPercentage,
    retracementFromTrough,
    isInDipBuyZone,
  };
}

/**
 * Builds a V2 scoring model focused on the "Dip-and-Rip" strategy.
 */
export function buildScoringModelV2(analyses: CallAnalysisV2[]): (features: TokenFeaturesV2) => number {
  return (features: TokenFeaturesV2): number => {
    let score = 1.0;

    // The "Dip-and-Rip" is the strongest signal.
    if (features.isInDipBuyZone) {
      score = 5.0; // High base score for matching the pattern
    } else {
      // If not in the zone, let's apply other heuristics
      // Penalize if it's still falling
      if (features.dipPercentage > 0.5 && features.retracementFromTrough < 0.05) {
        score *= 0.3; // Still a falling knife
      }
      // Reward tokens that had a strong run-up, even if not in the zone now
      if ((features.peakPrice7d / features.price) > 3) {
        score *= 1.5;
      }
    }

    // Still factor in market cap - smaller is generally more explosive
    const marketCapWeights = { micro: 1.5, small: 1.2, mid: 0.8, large: 0.5 };
    score *= marketCapWeights[features.marketCapCategory] || 1.0;

    // Add a small bonus for recent volume spikes
    if (features.volumeChange1h > 100) {
      score *= 1.2;
    }

    return score;
  };
}
