/**
 * Live Trade Strategies Database Functions
 * =======================================
 * Functions to get enabled/disabled strategies for live trade alerts
 */

import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from './logger';

const DB_PATH = path.join(process.cwd(), 'data', 'databases', 'simulations.db');

/**
 * Get enabled strategy IDs
 */
export async function getEnabledStrategies(): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;

    all(
      `SELECT id FROM live_trade_strategies WHERE enabled = 1`
    )
      .then((rows: any[]) => {
        db.close();
        const enabledSet = new Set<string>(rows.map((r: any) => r.id));
        resolve(enabledSet);
      })
      .catch((err) => {
        db.close();
        logger.error('Failed to get enabled strategies', err as Error);
        // Return default enabled strategies if table doesn't exist
        resolve(new Set(['initial_entry', 'trailing_entry', 'ichimoku_tenkan_kijun']));
      });
  });
}

/**
 * Check if a strategy is enabled
 */
export async function isStrategyEnabled(strategyId: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH);
    const get = promisify(db.get.bind(db)) as (query: string, params?: any[]) => Promise<any>;

    get(
      `SELECT enabled FROM live_trade_strategies WHERE id = ?`,
      [strategyId]
    )
      .then((row: any) => {
        db.close();
        // Default to enabled if not found (backward compatibility)
        resolve(row ? row.enabled === 1 : true);
      })
      .catch((err) => {
        db.close();
        logger.error('Failed to check strategy enabled status', err as Error);
        // Default to enabled on error
        resolve(true);
      });
  });
}

