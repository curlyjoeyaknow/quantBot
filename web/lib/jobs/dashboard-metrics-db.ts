// Database for storing pre-computed dashboard metrics
import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';

const DASHBOARD_METRICS_DB_PATH = process.env.DASHBOARD_METRICS_DB_PATH || 
  path.join(process.cwd(), '..', 'dashboard_metrics.db');

export interface DashboardMetrics {
  id?: number;
  computed_at: string;
  total_calls: number;
  pnl_from_alerts: number;
  max_drawdown: number;
  current_daily_profit: number;
  last_week_daily_profit: number;
  overall_profit: number;
  largest_gain: number;
  profit_since_october: number;
}

class DashboardMetricsDatabase {
  private static instance: DashboardMetricsDatabase;
  private db: Database | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  private constructor() {}

  static getInstance(): DashboardMetricsDatabase {
    if (!DashboardMetricsDatabase.instance) {
      DashboardMetricsDatabase.instance = new DashboardMetricsDatabase();
    }
    return DashboardMetricsDatabase.instance;
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
      const db = new Database(DASHBOARD_METRICS_DB_PATH, (err) => {
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
      CREATE TABLE IF NOT EXISTS dashboard_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        computed_at TEXT NOT NULL UNIQUE,
        total_calls INTEGER NOT NULL,
        pnl_from_alerts REAL NOT NULL,
        max_drawdown REAL NOT NULL,
        current_daily_profit REAL NOT NULL,
        last_week_daily_profit REAL NOT NULL,
        overall_profit REAL NOT NULL,
        largest_gain REAL NOT NULL,
        profit_since_october REAL NOT NULL
      )
    `);

    await run(`
      CREATE INDEX IF NOT EXISTS idx_computed_at ON dashboard_metrics(computed_at DESC)
    `);
  }

  async saveMetrics(metrics: DashboardMetrics): Promise<void> {
    const db = await this.getDatabase();
    const run = promisify(db.run.bind(db)) as (query: string, params?: any[]) => Promise<any>;

    await run(
      `INSERT OR REPLACE INTO dashboard_metrics 
       (computed_at, total_calls, pnl_from_alerts, max_drawdown, 
        current_daily_profit, last_week_daily_profit, overall_profit, 
        largest_gain, profit_since_october)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        metrics.computed_at,
        metrics.total_calls,
        metrics.pnl_from_alerts,
        metrics.max_drawdown,
        metrics.current_daily_profit,
        metrics.last_week_daily_profit,
        metrics.overall_profit,
        metrics.largest_gain,
        metrics.profit_since_october,
      ]
    );
  }

  async getLatestMetrics(): Promise<DashboardMetrics | null> {
    const db = await this.getDatabase();
    const get = promisify(db.get.bind(db));

    const row = await get(
      'SELECT * FROM dashboard_metrics ORDER BY computed_at DESC LIMIT 1'
    ) as any;

    if (!row) return null;

    return {
      id: row.id,
      computed_at: row.computed_at,
      total_calls: row.total_calls,
      pnl_from_alerts: row.pnl_from_alerts,
      max_drawdown: row.max_drawdown,
      current_daily_profit: row.current_daily_profit,
      last_week_daily_profit: row.last_week_daily_profit,
      overall_profit: row.overall_profit,
      largest_gain: row.largest_gain,
      profit_since_october: row.profit_since_october,
    };
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

export const dashboardMetricsDb = DashboardMetricsDatabase.getInstance();

