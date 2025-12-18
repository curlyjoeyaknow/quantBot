/**
 * Live Trade Database Functions
 * =============================
 * Database functions for storing live trade alerts and price cache
 */

import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from './logger';

const DB_PATH = path.join(process.cwd(), 'data', 'databases', 'simulations.db');

/**
 * Store entry alert in database
 */
export async function storeEntryAlert(alert: {
  alertId: number;
  tokenAddress: string;
  tokenSymbol?: string;
  chain: string;
  callerName: string;
  alertPrice: number;
  entryPrice: number;
  entryType: string;
  signal: string;
  priceChange: number;
  timestamp: number;
  sentToGroups?: string[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);

    db.run(
      `INSERT INTO live_trade_entry_alerts 
       (alert_id, token_address, token_symbol, chain, caller_name, alert_price, 
        entry_price, entry_type, signal, price_change, timestamp, sent_to_groups)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        alert.alertId,
        alert.tokenAddress,
        alert.tokenSymbol || null,
        alert.chain,
        alert.callerName,
        alert.alertPrice,
        alert.entryPrice,
        alert.entryType,
        alert.signal,
        alert.priceChange,
        alert.timestamp,
        alert.sentToGroups ? JSON.stringify(alert.sentToGroups) : null,
      ],
      function (err) {
        db.close();
        if (err) {
          logger.error('Failed to store entry alert', err as Error);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Store price in cache database
 */
export async function storePriceCache(
  tokenAddress: string,
  chain: string,
  price: number,
  marketCap?: number,
  timestamp?: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const ts = timestamp || Math.floor(Date.now() / 1000);

    db.run(
      `INSERT OR REPLACE INTO live_trade_price_cache 
       (token_address, chain, price, market_cap, timestamp)
       VALUES (?, ?, ?, ?, ?)`,
      [tokenAddress, chain, price, marketCap || null, ts],
      function (err) {
        db.close();
        if (err) {
          logger.error('Failed to store price cache', err as Error);
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Get cached price
 */
export async function getCachedPrice(
  tokenAddress: string,
  chain: string,
  maxAgeSeconds: number = 30
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const get = promisify(db.get.bind(db)) as (
      query: string,
      params?: Array<unknown>
    ) => Promise<Record<string, unknown> | undefined>;

    get(
      `SELECT price FROM live_trade_price_cache 
       WHERE token_address = ? AND chain = ? 
       AND timestamp > ? 
       ORDER BY timestamp DESC LIMIT 1`,
      [tokenAddress, chain, Math.floor(Date.now() / 1000) - maxAgeSeconds]
    )
      .then((row) => {
        db.close();
        const price = row ? Number((row as Record<string, unknown>).price) : null;
        resolve(price ?? null);
      })
      .catch((err) => {
        db.close();
        logger.error('Failed to get cached price', err as Error);
        reject(err);
      });
  });
}

/**
 * Get entry alerts for a token
 */
export async function getEntryAlertsForToken(
  tokenAddress: string,
  limit: number = 10
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const all = promisify(db.all.bind(db)) as (
      query: string,
      params?: Array<unknown>
    ) => Promise<Array<Record<string, unknown>>>;

    all(
      `SELECT * FROM live_trade_entry_alerts 
       WHERE token_address = ? 
       ORDER BY timestamp DESC 
       LIMIT ?`,
      [tokenAddress, limit]
    )
      .then((rows) => {
        db.close();
        resolve(rows);
      })
      .catch((err) => {
        db.close();
        logger.error('Failed to get entry alerts', err as Error);
        reject(err);
      });
  });
}
