/**
 * Performance Calculator - ClickHouse Integration
 * Calculates actual return multiples and time-to-peak from OHLCV data stored in ClickHouse
 */

import { getClickHouseClient } from '../clickhouse';
import { getEntryMcapWithFallback, isPumpOrBonkToken, calculatePumpBonkMcap } from './mcap-calculator';

export interface PerformanceMetrics {
  multiple: number;  // MCAP multiple (peakMcap / entryMcap)
  peakPrice: number;
  peakMcap: number;  // Calculated peak market cap
  entryMcap: number;  // Market cap at time of call
  timeToATHMinutes: number;
  peakTimestamp: Date;
}

export class PerformanceCalculator {
  /**
   * Calculate performance metrics for a single alert using ClickHouse OHLCV data
   * Uses MCAP-based calculations for more meaningful cross-token comparisons
   * 
   * MCAP Fallback Chain:
   * 1. Use provided entryMcap if available
   * 2. Check if pump.fun/bonk token → Calculate from price
   * 3. Fetch from Birdeye API
   * 4. Extract from messageText if provided
   * 5. Continue without MCAP (price multiples still valid)
   */
  async calculateAlertPerformance(
    tokenAddress: string,
    chain: string,
    alertTimestamp: Date,
    entryPrice: number,
    entryMcap?: number,     // Market cap at time of call (preferred)
    messageText?: string    // Original alert message (for MCAP extraction)
  ): Promise<PerformanceMetrics | null> {
    try {
      // If no MCAP provided, try to fetch/calculate it
      let effectiveEntryMcap = entryMcap;
      
      if (!effectiveEntryMcap) {
        // Use fallback chain to get MCAP
        effectiveEntryMcap = await getEntryMcapWithFallback(
          tokenAddress,
          chain,
          alertTimestamp,
          entryPrice,
          messageText
        ) || undefined;
      }
      // Calculate end time (7 days after alert)
      const endTime = new Date(alertTimestamp.getTime() + 7 * 24 * 60 * 60 * 1000);

      const client = getClickHouseClient();

      // Query ClickHouse for OHLCV data
      // ClickHouse has short addresses (8 chars), PostgreSQL has full addresses
      // Match using first 8 characters of the full address
      const shortAddress = tokenAddress.substring(0, 8);
      
      const startTs = alertTimestamp.toISOString().replace('T', ' ').substring(0, 19);
      const endTs = endTime.toISOString().replace('T', ' ').substring(0, 19);
      
      const query = `
        SELECT 
          toUnixTimestamp(timestamp) as ts,
          high,
          low,
          close
        FROM ohlcv_candles
        WHERE token_address = '${shortAddress}'
        AND chain = '${chain}'
        AND timestamp >= '${startTs}'
        AND timestamp <= '${endTs}'
        ORDER BY timestamp ASC
        LIMIT 10000
      `;

      const result = await client.query({
        query,
        format: 'JSONEachRow',
      });

      const data: any[] = await result.json();

      if (!data || data.length === 0) {
        return null;
      }

      // Find peak price and when it occurred
      let peakPrice = entryPrice;
      let peakTimestamp = alertTimestamp;

      for (const candle of data) {
        const high = parseFloat(candle.high);
        if (high > peakPrice) {
          peakPrice = high;
          peakTimestamp = new Date(candle.ts * 1000);
        }
      }

      // Calculate MCAP-based metrics
      // If no MCAP available even after fallback, use price as baseline (multiples still work)
      const finalEntryMcap = effectiveEntryMcap || entryPrice;
      
      // Calculate peak MCAP: peak_mcap = entry_mcap * (peak_price / entry_price)
      const priceMultiple = entryPrice > 0 ? peakPrice / entryPrice : 1.0;
      const peakMcap = finalEntryMcap * priceMultiple;
      
      // MCAP multiple = peak_mcap / entry_mcap = price_multiple (mathematically equivalent)
      const multiple = priceMultiple;

      // Calculate time to ATH in minutes
      const timeToATHMinutes = Math.round(
        (peakTimestamp.getTime() - alertTimestamp.getTime()) / (60 * 1000)
      );

      return {
        multiple,
        peakPrice,
        peakMcap,
        entryMcap: finalEntryMcap,
        timeToATHMinutes,
        peakTimestamp,
      };
    } catch (error) {
      console.error('Error calculating alert performance:', error);
      return null;
    }
  }

  /**
   * Calculate performance metrics for multiple alerts (batch)
   */
  async calculateBatchPerformance(
    alerts: Array<{
      tokenAddress: string;
      chain: string;
      alertTimestamp: Date;
      entryPrice: number;
      entryMcap?: number;    // Optional market cap at time of call
      messageText?: string;  // Optional original alert message
    }>
  ): Promise<Map<string, PerformanceMetrics>> {
    const results = new Map<string, PerformanceMetrics>();

    // Process in parallel with concurrency limit
    const CONCURRENCY = 10;
    const chunks = [];
    
    for (let i = 0; i < alerts.length; i += CONCURRENCY) {
      chunks.push(alerts.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(async (alert) => {
        const key = `${alert.chain}:${alert.tokenAddress}:${alert.alertTimestamp.getTime()}`;
        const metrics = await this.calculateAlertPerformance(
          alert.tokenAddress,
          alert.chain,
          alert.alertTimestamp,
          alert.entryPrice,
          alert.entryMcap,      // Pass MCAP if available
          alert.messageText     // Pass message for extraction
        );
        
        if (metrics) {
          results.set(key, metrics);
        }
      });

      await Promise.all(promises);
    }

    return results;
  }
}

export const performanceCalculator = new PerformanceCalculator();
