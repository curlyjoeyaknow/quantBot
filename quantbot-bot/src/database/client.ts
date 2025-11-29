/**
 * Database Client
 * ===============
 * Thin wrapper for database access supporting both SQLite (local) and PostgreSQL (AWS RDS)
 */

import * as sqlite3 from 'sqlite3';
import { Pool, Client } from 'pg';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface DatabaseConfig {
  databaseUrl?: string;
  callerDbPath?: string;
}

class DatabaseClient {
  private sqliteDb: sqlite3.Database | null = null;
  private callerDb: sqlite3.Database | null = null;
  private pgPool: Pool | null = null;
  private isPostgres: boolean = false;

  /**
   * Initialize database connection
   */
  async initialize(config: DatabaseConfig = {}): Promise<void> {
    const databaseUrl = config.databaseUrl || process.env.DATABASE_URL;
    const callerDbPath = config.callerDbPath || process.env.CALLER_DB_PATH || './caller_alerts.db';

    if (databaseUrl && databaseUrl.startsWith('postgresql://')) {
      // PostgreSQL mode (AWS RDS)
      this.isPostgres = true;
      this.pgPool = new Pool({
        connectionString: databaseUrl,
        max: 10, // Connection pool size
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Test connection
      try {
        await this.pgPool.query('SELECT 1');
        logger.info('Connected to PostgreSQL database');
      } catch (error) {
        logger.error('Failed to connect to PostgreSQL', error as Error);
        throw error;
      }
    } else {
      // SQLite mode (local development)
      this.isPostgres = false;
      const dbPath = databaseUrl?.replace('sqlite://', '') || path.join(process.cwd(), 'simulations.db');
      
      this.sqliteDb = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          logger.error('Failed to open SQLite database', err);
          throw err;
        }
        logger.info('Connected to SQLite database', { path: dbPath });
      });

      // Initialize caller database (SQLite only for now)
      this.callerDb = new sqlite3.Database(callerDbPath, (err) => {
        if (err) {
          logger.error('Failed to open caller database', err);
        } else {
          logger.info('Connected to caller database', { path: callerDbPath });
        }
      });
    }

    // Initialize schema
    await this.initSchema();
  }

  /**
   * Initialize database schema
   */
  private async initSchema(): Promise<void> {
    if (this.isPostgres) {
      // PostgreSQL schema initialization
      await this.pgPool!.query(`
        CREATE TABLE IF NOT EXISTS strategies (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          strategy TEXT NOT NULL,
          stop_loss_config TEXT NOT NULL,
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );
        
        CREATE TABLE IF NOT EXISTS simulation_runs (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          mint TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_name TEXT,
          token_symbol TEXT,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          strategy TEXT NOT NULL,
          stop_loss_config TEXT NOT NULL,
          strategy_name TEXT,
          final_pnl REAL NOT NULL,
          total_candles INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS ca_tracking (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          chat_id INTEGER NOT NULL,
          mint TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_name TEXT,
          token_symbol TEXT,
          call_price REAL NOT NULL,
          call_marketcap REAL,
          call_timestamp INTEGER NOT NULL,
          strategy TEXT NOT NULL,
          stop_loss_config TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_ca_tracking_user ON ca_tracking(user_id);
        CREATE INDEX IF NOT EXISTS idx_ca_tracking_active ON ca_tracking(is_active);
        
        CREATE TABLE IF NOT EXISTS ca_calls (
          id SERIAL PRIMARY KEY,
          mint TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_name TEXT,
          token_symbol TEXT,
          call_price REAL,
          call_marketcap REAL,
          call_timestamp INTEGER NOT NULL,
          caller TEXT,
          source_chat_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(mint, call_timestamp)
        );
        
        CREATE INDEX IF NOT EXISTS idx_user_id ON simulation_runs(user_id);
        CREATE INDEX IF NOT EXISTS idx_mint ON simulation_runs(mint);
        CREATE INDEX IF NOT EXISTS idx_strategy_user ON strategies(user_id);
      `);
    } else {
      // SQLite schema initialization
      const run = promisify(this.sqliteDb!.run.bind(this.sqliteDb!)) as (sql: string, params?: any[]) => Promise<any>;
      
      await run(`
        CREATE TABLE IF NOT EXISTS strategies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          strategy TEXT NOT NULL,
          stop_loss_config TEXT NOT NULL,
          is_default BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, name)
        );
        
        CREATE TABLE IF NOT EXISTS simulation_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          mint TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_name TEXT,
          token_symbol TEXT,
          start_time TEXT NOT NULL,
          end_time TEXT NOT NULL,
          strategy TEXT NOT NULL,
          stop_loss_config TEXT NOT NULL,
          strategy_name TEXT,
          final_pnl REAL NOT NULL,
          total_candles INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS ca_tracking (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          chat_id INTEGER NOT NULL,
          mint TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_name TEXT,
          token_symbol TEXT,
          call_price REAL NOT NULL,
          call_marketcap REAL,
          call_timestamp INTEGER NOT NULL,
          strategy TEXT NOT NULL,
          stop_loss_config TEXT NOT NULL,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_ca_tracking_user ON ca_tracking(user_id);
        CREATE INDEX IF NOT EXISTS idx_ca_tracking_active ON ca_tracking(is_active);
        
        CREATE TABLE IF NOT EXISTS ca_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mint TEXT NOT NULL,
          chain TEXT NOT NULL,
          token_name TEXT,
          token_symbol TEXT,
          call_price REAL,
          call_marketcap REAL,
          call_timestamp INTEGER NOT NULL,
          caller TEXT,
          source_chat_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(mint, call_timestamp)
        );
        
        CREATE INDEX IF NOT EXISTS idx_user_id ON simulation_runs(user_id);
        CREATE INDEX IF NOT EXISTS idx_mint ON simulation_runs(mint);
        CREATE INDEX IF NOT EXISTS idx_strategy_user ON strategies(user_id);
      `);
    }
  }

  /**
   * Convert PostgreSQL-style placeholders ($1, $2) to SQLite-style (?)
   */
  private convertPlaceholders(sql: string): string {
    if (!this.isPostgres) {
      // Convert $1, $2, etc. to ? for SQLite
      return sql.replace(/\$(\d+)/g, '?');
    }
    return sql;
  }

  /**
   * Execute a query (works for both SQLite and PostgreSQL)
   */
  async query(sql: string, params: any[] = []): Promise<any[]> {
    const convertedSql = this.convertPlaceholders(sql);
    if (this.isPostgres) {
      const result = await this.pgPool!.query(sql, params);
      return result.rows;
    } else {
      const all = promisify(this.sqliteDb!.all.bind(this.sqliteDb!)) as (sql: string, params?: any[]) => Promise<any[]>;
      return await all(convertedSql, params);
    }
  }

  /**
   * Execute a query and get single row
   */
  async queryOne(sql: string, params: any[] = []): Promise<any> {
    const convertedSql = this.convertPlaceholders(sql);
    if (this.isPostgres) {
      const result = await this.pgPool!.query(sql, params);
      return result.rows[0] || null;
    } else {
      const get = promisify(this.sqliteDb!.get.bind(this.sqliteDb!)) as (sql: string, params?: any[]) => Promise<any>;
      return await get(convertedSql, params);
    }
  }

  /**
   * Execute a query that doesn't return results (INSERT, UPDATE, DELETE)
   */
  async execute(sql: string, params: any[] = []): Promise<void> {
    const convertedSql = this.convertPlaceholders(sql);
    if (this.isPostgres) {
      await this.pgPool!.query(sql, params);
    } else {
      const run = promisify(this.sqliteDb!.run.bind(this.sqliteDb!)) as (sql: string, params?: any[]) => Promise<any>;
      await run(convertedSql, params);
    }
  }

  /**
   * Get caller database (SQLite only for now)
   */
  getCallerDb(): sqlite3.Database | null {
    return this.callerDb;
  }

  /**
   * Close database connections
   */
  async close(): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.end();
      logger.info('PostgreSQL connection pool closed');
    } else if (this.sqliteDb) {
      return new Promise((resolve, reject) => {
        this.sqliteDb!.close((err) => {
          if (err) reject(err);
          else {
            logger.info('SQLite database closed');
            resolve();
          }
        });
      });
    }
    
    if (this.callerDb) {
      return new Promise((resolve, reject) => {
        this.callerDb!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }
}

// Singleton instance
let dbClient: DatabaseClient | null = null;

export function getDatabaseClient(): DatabaseClient {
  if (!dbClient) {
    dbClient = new DatabaseClient();
  }
  return dbClient;
}

// Export database functions that the bot needs
export interface SimulationRunData {
  id: number;
  user_id: number;
  mint: string;
  chain: string;
  token_name?: string;
  token_symbol?: string;
  start_time: string;
  end_time: string;
  strategy: string;
  stop_loss_config: string;
  strategy_name?: string;
  final_pnl: number;
  total_candles: number;
  created_at: string;
}

export interface StrategyData {
  id: number;
  user_id: number;
  name: string;
  description?: string;
  strategy: string;
  stop_loss_config: string;
  is_default: boolean;
  created_at: string;
}

export interface CACall {
  id: number;
  mint: string;
  chain: string;
  token_name?: string;
  token_symbol?: string;
  call_price?: number;
  call_marketcap?: number;
  call_timestamp: number;
  caller?: string;
  source_chat_id?: number;
  created_at: string;
}

/**
 * Save a simulation run
 */
export async function saveSimulationRun(data: {
  userId: number;
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  startTime: string;
  endTime: string;
  strategy: string;
  stopLossConfig: string;
  strategyName?: string;
  finalPnl: number;
  totalCandles: number;
}): Promise<number> {
  const db = getDatabaseClient();
  const sql = `
    INSERT INTO simulation_runs (user_id, mint, chain, token_name, token_symbol, start_time, end_time, strategy, stop_loss_config, strategy_name, final_pnl, total_candles)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING id
  `;
  
  const params = [
    data.userId,
    data.mint,
    data.chain,
    data.tokenName || null,
    data.tokenSymbol || null,
    data.startTime,
    data.endTime,
    data.strategy,
    data.stopLossConfig,
    data.strategyName || null,
    data.finalPnl,
    data.totalCandles,
  ];

  if (db['isPostgres']) {
    const result = await db.query(sql, params);
    return result[0].id;
  } else {
    // SQLite - need to get last insert ID
    await db.execute(
      `INSERT INTO simulation_runs (user_id, mint, chain, token_name, token_symbol, start_time, end_time, strategy, stop_loss_config, strategy_name, final_pnl, total_candles)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    const result = await db.queryOne('SELECT last_insert_rowid() as id');
    return result.id;
  }
}

/**
 * Get user simulation runs
 */
export async function getUserSimulationRuns(userId: number, limit: number = 10): Promise<DatabaseSimulationRunRow[]> {
  const db = getDatabaseClient();
  const sql = `
    SELECT * FROM simulation_runs 
    WHERE user_id = $1 
    ORDER BY created_at DESC 
    LIMIT $2
  `;
  
  const rows = await db.query(sql, [userId, limit]);
  return rows.map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    mint: row.mint,
    chain: row.chain,
    token_name: row.token_name,
    token_symbol: row.token_symbol,
    start_time: row.start_time,
    end_time: row.end_time,
    strategy: row.strategy,
    stop_loss_config: row.stop_loss_config,
    strategy_name: row.strategy_name,
    final_pnl: row.final_pnl,
    total_candles: row.total_candles,
    created_at: row.created_at,
  }));
}

/**
 * Save a strategy
 */
export async function saveStrategy(data: {
  userId: number;
  name: string;
  description?: string;
  strategy: string;
  stopLossConfig: string;
  isDefault?: boolean;
}): Promise<number> {
  const db = getDatabaseClient();
  const sql = `
    INSERT INTO strategies (user_id, name, description, strategy, stop_loss_config, is_default)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, name) DO UPDATE SET
      description = $3,
      strategy = $4,
      stop_loss_config = $5,
      is_default = $6
    RETURNING id
  `;
  
  const params = [
    data.userId,
    data.name,
    data.description || null,
    data.strategy,
    data.stopLossConfig,
    data.isDefault || false,
  ];

  if (db['isPostgres']) {
    const result = await db.query(sql, params);
    return result[0].id;
  } else {
    // SQLite - use INSERT OR REPLACE
    await db.execute(
      `INSERT OR REPLACE INTO strategies (user_id, name, description, strategy, stop_loss_config, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
      params
    );
    const result = await db.queryOne('SELECT id FROM strategies WHERE user_id = ? AND name = ?', [data.userId, data.name]);
    return result.id;
  }
}

/**
 * Get user strategies
 */
export async function getUserStrategies(userId: number): Promise<StrategyData[]> {
  const db = getDatabaseClient();
  const sql = `SELECT * FROM strategies WHERE user_id = $1 ORDER BY created_at DESC`;
  const rows = await db.query(sql, [userId]);
  return rows.map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    strategy: row.strategy,
    stop_loss_config: row.stop_loss_config,
    is_default: row.is_default === true || row.is_default === 1,
    created_at: row.created_at,
  }));
}

/**
 * Get a strategy by ID
 */
export async function getStrategy(id: number): Promise<StrategyData | null> {
  const db = getDatabaseClient();
  const sql = `SELECT * FROM strategies WHERE id = $1`;
  const row = await db.queryOne(sql, [id]);
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    strategy: row.strategy,
    stop_loss_config: row.stop_loss_config,
    is_default: row.is_default === true || row.is_default === 1,
    created_at: row.created_at,
  };
}

/**
 * Delete a strategy
 */
export async function deleteStrategy(id: number, userId: number): Promise<void> {
  const db = getDatabaseClient();
  await db.execute('DELETE FROM strategies WHERE id = $1 AND user_id = $2', [id, userId]);
}

/**
 * Save a CA drop to ca_tracking table (for active tracking)
 */
export async function saveCADrop(data: {
  userId: number;
  chatId: number;
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  callPrice: number;
  callMarketcap?: number;
  callTimestamp: number;
  strategy: any[];
  stopLossConfig: any;
}): Promise<number> {
  const db = getDatabaseClient();
  const sql = `
    INSERT INTO ca_tracking (user_id, chat_id, mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, strategy, stop_loss_config)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `;
  
  const params = [
    data.userId,
    data.chatId,
    data.mint,
    data.chain,
    data.tokenName || null,
    data.tokenSymbol || null,
    data.callPrice,
    data.callMarketcap || null,
    data.callTimestamp,
    typeof data.strategy === 'string' ? data.strategy : JSON.stringify(data.strategy),
    typeof data.stopLossConfig === 'string' ? data.stopLossConfig : JSON.stringify(data.stopLossConfig),
  ];

  if (db['isPostgres']) {
    const result = await db.query(sql, params);
    return result[0].id;
  } else {
    // SQLite
    await db.execute(
      `INSERT INTO ca_tracking (user_id, chat_id, mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, strategy, stop_loss_config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    const result = await db.queryOne('SELECT last_insert_rowid() as id');
    return result.id;
  }
}

/**
 * Save a CA call to ca_calls table (for historical tracking)
 */
export async function saveCACall(data: {
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  callPrice?: number;
  callMarketcap?: number;
  callTimestamp: number;
  caller?: string;
  sourceChatId?: number;
}): Promise<number | null> {
  const db = getDatabaseClient();
  const sql = `
    INSERT INTO ca_calls (mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, caller, source_chat_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (mint, call_timestamp) DO NOTHING
    RETURNING id
  `;
  
  const params = [
    data.mint,
    data.chain,
    data.tokenName || null,
    data.tokenSymbol || null,
    data.callPrice || null,
    data.callMarketcap || null,
    data.callTimestamp,
    data.caller || null,
    data.sourceChatId || null,
  ];

  if (db['isPostgres']) {
    const result = await db.query(sql, params);
    return result[0]?.id || null;
  } else {
    // SQLite - use INSERT OR IGNORE
    await db.execute(
      `INSERT OR IGNORE INTO ca_calls (mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, caller, source_chat_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params
    );
    const result = await db.queryOne('SELECT id FROM ca_calls WHERE mint = ? AND call_timestamp = ?', [data.mint, data.callTimestamp]);
    return result?.id || null;
  }
}

/**
 * Get all CA calls
 */
export async function getAllCACalls(limit: number = 50): Promise<CACall[]> {
  const db = getDatabaseClient();
  const sql = `SELECT * FROM ca_calls ORDER BY call_timestamp DESC LIMIT $1`;
  const rows = await db.query(sql, [limit]);
  return rows.map((row: any) => ({
    id: row.id,
    mint: row.mint,
    chain: row.chain,
    token_name: row.token_name,
    token_symbol: row.token_symbol,
    call_price: row.call_price,
    call_marketcap: row.call_marketcap,
    call_timestamp: row.call_timestamp,
    caller: row.caller,
    source_chat_id: row.source_chat_id,
    created_at: row.created_at,
  }));
}

/**
 * Get CA call by mint
 */
export async function getCACallByMint(mint: string): Promise<CACall | null> {
  const db = getDatabaseClient();
  const sql = `SELECT * FROM ca_calls WHERE mint = $1 ORDER BY call_timestamp DESC LIMIT 1`;
  const row = await db.queryOne(sql, [mint]);
  if (!row) return null;
  return {
    id: row.id,
    mint: row.mint,
    chain: row.chain,
    token_name: row.token_name,
    token_symbol: row.token_symbol,
    call_price: row.call_price,
    call_marketcap: row.call_marketcap,
    call_timestamp: row.call_timestamp,
    caller: row.caller,
    source_chat_id: row.source_chat_id,
    created_at: row.created_at,
  };
}

/**
 * Get active CA tracking
 */
export async function getActiveCATracking(): Promise<any[]> {
  const db = getDatabaseClient();
  const sql = `SELECT * FROM ca_tracking WHERE is_active = $1 ORDER BY created_at DESC`;
  return await db.query(sql, [true]);
}

