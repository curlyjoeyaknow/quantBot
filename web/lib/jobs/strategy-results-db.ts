// Database schema and utilities for storing pre-computed strategy results
import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const STRATEGY_RESULTS_DB_PATH = process.env.STRATEGY_RESULTS_DB_PATH || 
  path.join(process.cwd(), '..', 'strategy_results.db');

export interface StrategyResult {
  id?: number;
  alert_id: number;
  token_address: string;
  chain: string;
  caller_name: string;
  alert_timestamp: string;
  entry_price: number;
  exit_price: number;
  pnl: number;
  max_reached: number;
  hold_duration_minutes: number;
  entry_time: number;
  exit_time: number;
  computed_at: string;
}

class StrategyResultsDatabase {
  private static instance: StrategyResultsDatabase;
  private db: Database | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): StrategyResultsDatabase {
    if (!StrategyResultsDatabase.instance) {
      StrategyResultsDatabase.instance = new StrategyResultsDatabase();
    }
    return StrategyResultsDatabase.instance;
  }

  async getDatabase(): Promise<Database> {
    if (this.db) {
      return this.db;
    }

    if (this.isInitializing && this.initPromise) {
      await this.initPromise;
      if (this.db) return this.db;
    }

    this.isInitializing = true;
    this.initPromise = new Promise((resolve, reject) => {
      const db = new Database(STRATEGY_RESULTS_DB_PATH, (err) => {
        if (err) {
          this.isInitializing = false;
          this.initPromise = null;
          reject(err);
        } else {
          this.db = db;
          this.initDatabase().then(() => {
            this.isInitializing = false;
            this.initPromise = null;
            resolve();
          }).catch(reject);
        }
      });
    });

    await this.initPromise;
    if (!this.db) {
      throw new Error('Failed to initialize database');
    }
    return this.db;
  }

  private async initDatabase(): Promise<void> {
    if (!this.db) return;

    const run = promisify(this.db.run.bind(this.db));

    await run(`
      CREATE TABLE IF NOT EXISTS strategy_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        chain TEXT NOT NULL,
        caller_name TEXT NOT NULL,
        alert_timestamp TEXT NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        pnl REAL NOT NULL,
        max_reached REAL NOT NULL,
        hold_duration_minutes INTEGER NOT NULL,
        entry_time INTEGER NOT NULL,
        exit_time INTEGER NOT NULL,
        computed_at TEXT NOT NULL,
        UNIQUE(alert_id)
      )
    `);

    // Create indexes for faster queries
    await run(`
      CREATE INDEX IF NOT EXISTS idx_alert_id ON strategy_results(alert_id)
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS idx_token_address ON strategy_results(token_address)
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS idx_caller_name ON strategy_results(caller_name)
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON strategy_results(alert_timestamp)
    `);
    await run(`
      CREATE INDEX IF NOT EXISTS idx_computed_at ON strategy_results(computed_at)
    `);
  }

  async saveResult(result: StrategyResult): Promise<void> {
    const db = await this.getDatabase();
    const run = promisify(db.run.bind(db)) as (query: string, params?: any[]) => Promise<any>;

    await run(
      `INSERT OR REPLACE INTO strategy_results 
       (alert_id, token_address, chain, caller_name, alert_timestamp, 
        entry_price, exit_price, pnl, max_reached, hold_duration_minutes, 
        entry_time, exit_time, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        result.alert_id,
        result.token_address,
        result.chain,
        result.caller_name,
        result.alert_timestamp,
        result.entry_price,
        result.exit_price,
        result.pnl,
        result.max_reached,
        result.hold_duration_minutes,
        result.entry_time,
        result.exit_time,
        result.computed_at,
      ]
    );
  }

  async getResult(alertId: number): Promise<StrategyResult | null> {
    const db = await this.getDatabase();
    const get = promisify(db.get.bind(db)) as (query: string, params?: any[]) => Promise<any>;

    const row = await get(
      'SELECT * FROM strategy_results WHERE alert_id = ?',
      [alertId]
    ) as any;

    if (!row) return null;

    return {
      id: row.id,
      alert_id: row.alert_id,
      token_address: row.token_address,
      chain: row.chain,
      caller_name: row.caller_name,
      alert_timestamp: row.alert_timestamp,
      entry_price: row.entry_price,
      exit_price: row.exit_price,
      pnl: row.pnl,
      max_reached: row.max_reached,
      hold_duration_minutes: row.hold_duration_minutes,
      entry_time: row.entry_time,
      exit_time: row.exit_time,
      computed_at: row.computed_at,
    };
  }

  async getResultsByCaller(callerName: string, limit?: number): Promise<StrategyResult[]> {
    const db = await this.getDatabase();
    const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;

    const query = limit
      ? 'SELECT * FROM strategy_results WHERE caller_name = ? ORDER BY alert_timestamp DESC LIMIT ?'
      : 'SELECT * FROM strategy_results WHERE caller_name = ? ORDER BY alert_timestamp DESC';

    const rows = await all(query, limit ? [callerName, limit] : [callerName]) as any[];

    return rows.map(row => ({
      id: row.id,
      alert_id: row.alert_id,
      token_address: row.token_address,
      chain: row.chain,
      caller_name: row.caller_name,
      alert_timestamp: row.alert_timestamp,
      entry_price: row.entry_price,
      exit_price: row.exit_price,
      pnl: row.pnl,
      max_reached: row.max_reached,
      hold_duration_minutes: row.hold_duration_minutes,
      entry_time: row.entry_time,
      exit_time: row.exit_time,
      computed_at: row.computed_at,
    }));
  }

  async getUncomputedAlerts(limit: number = 100): Promise<number[]> {
    // Need to query caller_alerts database separately
    const { dbManager } = await import('@/lib/db-manager');
    const db = await dbManager.getDatabase();
    const all = promisify(db.all.bind(db)) as (query: string, params?: any[]) => Promise<any[]>;
    const strategyDb = await this.getDatabase();
    const strategyAll = promisify(strategyDb.all.bind(strategyDb));

    // Get all computed alert IDs
    const computedIds = await strategyAll(
      'SELECT alert_id FROM strategy_results'
    ) as any[];
    const computedSet = new Set(computedIds.map((r: any) => r.alert_id));

    // Get alerts that don't have results yet
    const rows = await all(
      `SELECT id 
       FROM caller_alerts 
       WHERE price_at_alert IS NOT NULL
       ORDER BY alert_timestamp DESC
       LIMIT ?`,
      [limit * 2] // Get more to filter out computed ones
    ) as any[];

    // Filter out already computed
    const uncomputed = rows
      .filter(row => !computedSet.has(row.id))
      .slice(0, limit)
      .map(row => row.id);

    return uncomputed;
  }

  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db!.close((err) => {
          if (err) reject(err);
          else {
            this.db = null;
            resolve();
          }
        });
      });
    }
  }
}

export const strategyResultsDb = StrategyResultsDatabase.getInstance();

