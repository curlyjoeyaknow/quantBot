/**
 * Fetch Historical Candles Utility
 * =================================
 * Fetches historical candles for live monitoring initialization.
 * Uses 3 API calls: 1m, 5m, and 1h timeframes.
 */

import { DateTime } from 'luxon';
import { birdeyeClient } from '../api/birdeye-client';
import { Candle } from '../simulation/candles';
import { logger } from './logger';
import { insertCandles } from '../storage/clickhouse-client';

/**
 * Fetch historical candles for a token
 * Makes 3 API calls: 1m, 5m, and 1h
 * Returns 5m candles (used by monitoring service) with up to 5000 candles
 */
export async function fetchHistoricalCandlesForMonitoring(
  tokenAddress: string,
  chain: string = 'solana',
  alertTime?: Date
): Promise<Candle[]> {
  try {
    const now = DateTime.utc();
    // Calculate start time to get ~5000 5-minute candles
    // 5000 * 5 minutes = 25000 minutes = ~17.4 days
    const startTime = now.minus({ days: 18 });
    const endTime = now;

    logger.info('Fetching historical candles for monitoring', {
      tokenAddress: tokenAddress.substring(0, 20),
      chain,
      startTime: startTime.toISO(),
      endTime: endTime.toISO(),
    });

    // Make 3 API calls as requested
    // 1. Fetch 1m candles (up to 5000 = ~3.5 days)
    const start1m = now.minus({ days: 4 }); // ~4 days to get ~5000 1m candles
    const candles1m = await fetchCandles(tokenAddress, chain, start1m, endTime, '1m');
    
    // 2. Fetch 5m candles (up to 5000 = ~17 days) - this is what we'll use
    const candles5m = await fetchCandles(tokenAddress, chain, startTime, endTime, '5m');
    
    // 3. Fetch 1h candles (up to 5000 = ~208 days) - for longer-term context
    const start1h = now.minus({ days: 210 });
    const candles1h = await fetchCandles(tokenAddress, chain, start1h, endTime, '1H');

    logger.info('Fetched historical candles', {
      tokenAddress: tokenAddress.substring(0, 20),
      '1m': candles1m.length,
      '5m': candles5m.length,
      '1h': candles1h.length,
    });

    // Store candles in ClickHouse
    try {
      // Store 1m candles
      if (candles1m.length > 0) {
        await insertCandles(tokenAddress, chain, candles1m, '1m', true);
        logger.debug('Stored 1m candles in ClickHouse', {
          tokenAddress: tokenAddress.substring(0, 20),
          count: candles1m.length,
        });
      }

      // Store 5m candles
      if (candles5m.length > 0) {
        await insertCandles(tokenAddress, chain, candles5m, '5m', true);
        logger.debug('Stored 5m candles in ClickHouse', {
          tokenAddress: tokenAddress.substring(0, 20),
          count: candles5m.length,
        });
      }

      // Store 1h candles
      if (candles1h.length > 0) {
        await insertCandles(tokenAddress, chain, candles1h, '1H', true);
        logger.debug('Stored 1h candles in ClickHouse', {
          tokenAddress: tokenAddress.substring(0, 20),
          count: candles1h.length,
        });
      }
    } catch (error) {
      logger.warn('Failed to store candles in ClickHouse', {
        error: error instanceof Error ? error.message : String(error),
        tokenAddress: tokenAddress.substring(0, 20),
      });
      // Continue even if storage fails - we still return the candles
    }

    // Return 5m candles (used by monitoring service)
    // If we have alert time, prioritize candles around that time
    if (alertTime && candles1m.length > 0) {
      // Merge 1m candles around alert time with 5m candles
      const alertDateTime = DateTime.fromJSDate(alertTime);
      const alertWindowStart = alertDateTime.minus({ minutes: 30 });
      const alertWindowEnd = alertDateTime.plus({ minutes: 30 });

      // Filter 1m candles in alert window
      const alertWindow1m = candles1m.filter(c => {
        const candleTime = DateTime.fromSeconds(c.timestamp);
        return candleTime >= alertWindowStart && candleTime <= alertWindowEnd;
      });

      // Combine: 5m candles + 1m candles in alert window
      const combined = [...candles5m];
      
      // Add 1m candles that aren't already covered by 5m candles
      for (const candle1m of alertWindow1m) {
        const candle1mTime = DateTime.fromSeconds(candle1m.timestamp);
        const isCovered = candles5m.some(c5m => {
          const c5mTime = DateTime.fromSeconds(c5m.timestamp);
          // Check if 1m candle falls within a 5m candle's time window
          return Math.abs(candle1mTime.toSeconds() - c5mTime.toSeconds()) < 300;
        });
        
        if (!isCovered) {
          combined.push(candle1m);
        }
      }

      // Sort by timestamp and return
      return combined.sort((a, b) => a.timestamp - b.timestamp).slice(-5000); // Keep last 5000
    }

    // Return 5m candles (limit to 5000)
    return candles5m.slice(-5000);
  } catch (error) {
    logger.error('Failed to fetch historical candles', error as Error, {
      tokenAddress: tokenAddress.substring(0, 20),
    });
    // Return empty array on error - monitoring will start with empty candles
    return [];
  }
}

/**
 * Helper to fetch candles from Birdeye
 */
async function fetchCandles(
  tokenAddress: string,
  chain: string,
  startTime: DateTime,
  endTime: DateTime,
  interval: '1m' | '5m' | '1H'
): Promise<Candle[]> {
  try {
    const startUnix = Math.floor(startTime.toSeconds());
    const endUnix = Math.floor(endTime.toSeconds());

    const response = await birdeyeClient.fetchOHLCVData(
      tokenAddress,
      new Date(startUnix * 1000),
      new Date(endUnix * 1000),
      interval
    );

    if (!response || !response.items || response.items.length === 0) {
      return [];
    }

    // Convert to Candle format
    return response.items
      .map(item => ({
        timestamp: item.unixTime,
        open: parseFloat(String(item.open)) || 0,
        high: parseFloat(String(item.high)) || 0,
        low: parseFloat(String(item.low)) || 0,
        close: parseFloat(String(item.close)) || 0,
        volume: parseFloat(String(item.volume)) || 0,
      }))
      .filter(c => c.timestamp >= startUnix && c.timestamp <= endUnix)
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    logger.warn('Failed to fetch candles', {
      error: error instanceof Error ? error.message : String(error),
      tokenAddress: tokenAddress.substring(0, 20),
      interval,
    });
    return [];
  }
}

