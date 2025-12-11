/**
 * Entry Price Determination Service
 * 
 * Determines entry price based on alert, time, or manual input.
 */

import { DateTime } from 'luxon';
import { ohlcvService } from '../../services/ohlcv-service';
import { logger } from '../../utils/logger';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const DB_PATH = path.join(process.cwd(), 'simulations.db');

export type EntryType = 'alert' | 'time' | 'manual';

export interface EntryPriceResult {
  entryPrice: number;
  entryTimestamp: number;
  entryType: EntryType;
  source?: string;
}

/**
 * Determine entry price based on type
 */
export async function determineEntryPrice(
  mint: string,
  chain: string,
  entryTime: DateTime,
  entryType: EntryType,
  manualPrice?: number
): Promise<EntryPriceResult> {
  switch (entryType) {
    case 'alert':
      return await getAlertEntryPrice(mint, chain, entryTime);
    case 'time':
      return await getTimeEntryPrice(mint, chain, entryTime);
    case 'manual':
      if (manualPrice === undefined) {
        throw new Error('Manual entry price is required');
      }
      return {
        entryPrice: manualPrice,
        entryTimestamp: Math.floor(entryTime.toSeconds()),
        entryType: 'manual',
        source: 'user_provided',
      };
    default:
      throw new Error(`Unknown entry type: ${entryType}`);
  }
}

/**
 * Get entry price from alert (ca_calls table)
 */
async function getAlertEntryPrice(
  mint: string,
  chain: string,
  entryTime: DateTime
): Promise<EntryPriceResult> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        return reject(err);
      }

      const entryUnix = Math.floor(entryTime.toSeconds());
      // Find the closest alert within 1 hour window
      const windowStart = entryUnix - 3600; // 1 hour before
      const windowEnd = entryUnix + 3600; // 1 hour after

      db.get(
        `SELECT call_price, call_timestamp
         FROM ca_calls
         WHERE mint = ? AND chain = ?
           AND call_timestamp >= ? AND call_timestamp <= ?
         ORDER BY ABS(call_timestamp - ?)
         LIMIT 1`,
        [mint, chain, windowStart, windowEnd, entryUnix],
        (err, row: any) => {
          db.close();
          if (err) {
            return reject(err);
          }

          if (!row || !row.call_price) {
            // Fallback to time-based entry
            logger.warn('No alert found, falling back to time-based entry', {
              mint: mint.substring(0, 20),
            });
            return getTimeEntryPrice(mint, chain, entryTime)
              .then(resolve)
              .catch(reject);
          }

          resolve({
            entryPrice: row.call_price,
            entryTimestamp: row.call_timestamp,
            entryType: 'alert',
            source: 'ca_calls',
          });
        }
      );
    });
  });
}

/**
 * Get entry price at specific time from candles
 */
async function getTimeEntryPrice(
  mint: string,
  chain: string,
  entryTime: DateTime
): Promise<EntryPriceResult> {
  try {
    // Fetch candles around the entry time (5 minutes window)
    const startTime = entryTime.minus({ minutes: 2 });
    const endTime = entryTime.plus({ minutes: 3 });

    const candles = await ohlcvService.getCandles(
      mint,
      chain,
      startTime,
      endTime,
      { interval: '1m', useCache: true }
    );

    if (candles.length === 0) {
      throw new Error('No candle data available for entry time');
    }

    // Find the candle that contains the entry time
    const entryUnix = Math.floor(entryTime.toSeconds());
    let entryCandle = candles.find(
      (c) => c.timestamp <= entryUnix && c.timestamp + 60 >= entryUnix
    );

    // If no exact match, use the closest candle
    if (!entryCandle) {
      entryCandle = candles.reduce((closest, candle) => {
        const closestDiff = Math.abs(closest.timestamp - entryUnix);
        const candleDiff = Math.abs(candle.timestamp - entryUnix);
        return candleDiff < closestDiff ? candle : closest;
      });
    }

    // Use the open price of the entry candle (or close if open is not available)
    const entryPrice = entryCandle.open || entryCandle.close;

    if (!entryPrice || isNaN(entryPrice)) {
      throw new Error('Invalid entry price from candles');
    }

    return {
      entryPrice,
      entryTimestamp: entryCandle.timestamp,
      entryType: 'time',
      source: 'ohlcv_candles',
    };
  } catch (error: any) {
    logger.error('Failed to get time-based entry price', error as Error, {
      mint: mint.substring(0, 20),
    });
    throw error;
  }
}

