"use strict";
/**
 * Database Module
 *
 * Provides a type-safe, maintainable API for accessing and modifying simulation and CA-tracking data
 * using a SQLite database.
 *
 * Sections:
 *   1. Database Initialization & Lifecycle
 *   2. Simulation Run Management
 *   3. Strategy Management
 *   4. CA Tracking & Alerts
 *   5. Utility Functions
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.saveSimulationRun = saveSimulationRun;
exports.getUserSimulationRuns = getUserSimulationRuns;
exports.getSimulationRun = getSimulationRun;
exports.getSimulationEvents = getSimulationEvents;
exports.saveStrategy = saveStrategy;
exports.getUserStrategies = getUserStrategies;
exports.getStrategy = getStrategy;
exports.deleteStrategy = deleteStrategy;
exports.saveCADrop = saveCADrop;
exports.getActiveCATracking = getActiveCATracking;
exports.upsertPumpfunToken = upsertPumpfunToken;
exports.markPumpfunGraduated = markPumpfunGraduated;
exports.getPumpfunTokenRecords = getPumpfunTokenRecords;
exports.getTrackedTokens = getTrackedTokens;
exports.savePriceUpdate = savePriceUpdate;
exports.saveAlertSent = saveAlertSent;
exports.getRecentCAPerformance = getRecentCAPerformance;
exports.getAllCACalls = getAllCACalls;
exports.getCACallByMint = getCACallByMint;
exports.getCACallsByCaller = getCACallsByCaller;
exports.getCACallsByChain = getCACallsByChain;
exports.saveCACall = saveCACall;
exports.closeDatabase = closeDatabase;
const sqlite3 = __importStar(require("sqlite3"));
const luxon_1 = require("luxon");
const path = __importStar(require("path"));
const logger_1 = require("./logger");
// ---------------------------------------------------------------------
// 1. Database Initialization & Lifecycle
// ---------------------------------------------------------------------
/** Absolute path to the SQLite database file. */
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/** Singleton instance of the SQLite database. */
let db = null;
/**
 * Initializes the SQLite database connection.
 * Creates required tables and indices if they do not exist.
 *
 * @returns {Promise<void>}
 */
function initDatabase() {
    const TABLES_AND_INDICES_SQL = `
    -- Strategies definition
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
    -- Simulation runs
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
    -- Simulation events
    CREATE TABLE IF NOT EXISTS simulation_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      price REAL NOT NULL,
      description TEXT NOT NULL,
      remaining_position REAL NOT NULL,
      pnl_so_far REAL NOT NULL,
      FOREIGN KEY (run_id) REFERENCES simulation_runs (id)
    );
    -- CA tracking
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
    
    -- Historical CA calls/alerts for backtesting
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
    
    -- Price updates for CA tracking
    CREATE TABLE IF NOT EXISTS price_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ca_id INTEGER NOT NULL,
      price REAL NOT NULL,
      marketcap REAL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (ca_id) REFERENCES ca_tracking (id)
    );
    -- Alerts sent for CA
    CREATE TABLE IF NOT EXISTS alerts_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ca_id INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      price REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (ca_id) REFERENCES ca_tracking (id)
    );
    -- Live trade entry alerts
    CREATE TABLE IF NOT EXISTS live_trade_entry_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER NOT NULL,
      token_address TEXT NOT NULL,
      token_symbol TEXT,
      chain TEXT NOT NULL,
      caller_name TEXT NOT NULL,
      alert_price REAL NOT NULL,
      entry_price REAL NOT NULL,
      entry_type TEXT NOT NULL,
      signal TEXT NOT NULL,
      price_change REAL NOT NULL,
      timestamp INTEGER NOT NULL,
      sent_to_groups TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Live trade price cache
    CREATE TABLE IF NOT EXISTS live_trade_price_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      price REAL NOT NULL,
      market_cap REAL,
      timestamp INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(token_address, chain, timestamp)
    );
    -- Live trade strategies configuration
    CREATE TABLE IF NOT EXISTS live_trade_strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Pump.fun token lifecycle tracking
    CREATE TABLE IF NOT EXISTS pumpfun_tokens (
      mint TEXT PRIMARY KEY,
      creator TEXT,
      bonding_curve TEXT,
      launch_signature TEXT,
      launch_timestamp INTEGER,
      graduation_signature TEXT,
      graduation_timestamp INTEGER,
      is_graduated BOOLEAN DEFAULT 0,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Tokens registry
    CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      chain TEXT NOT NULL DEFAULT 'solana',
      token_name TEXT,
      token_symbol TEXT,
      added_by_user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(mint, chain)
    );
    -- Enhanced simulation_runs with entry tracking
    -- Note: We'll add columns via ALTER TABLE to avoid breaking existing data
    -- Indices for performance
    CREATE INDEX IF NOT EXISTS idx_user_id ON simulation_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_mint ON simulation_runs(mint);
    CREATE INDEX IF NOT EXISTS idx_created_at ON simulation_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_strategy_user ON strategies(user_id);
    CREATE INDEX IF NOT EXISTS idx_strategy_name ON strategies(name);
    CREATE INDEX IF NOT EXISTS idx_tokens_mint_chain ON tokens(mint, chain);
  `;
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_PATH, (openErr) => {
            if (openErr) {
                logger_1.logger.error('Error opening database', openErr);
                return reject(openErr);
            }
            logger_1.logger.info('Connected to SQLite database');
            db.exec(TABLES_AND_INDICES_SQL, (tableErr) => {
                if (tableErr) {
                    logger_1.logger.error('Error creating tables', tableErr);
                    return reject(tableErr);
                }
                // Add new columns to simulation_runs if they don't exist (migration)
                db.exec(`
          -- Add new columns to simulation_runs for entry tracking
          ALTER TABLE simulation_runs ADD COLUMN entry_type TEXT;
          ALTER TABLE simulation_runs ADD COLUMN entry_price REAL;
          ALTER TABLE simulation_runs ADD COLUMN entry_timestamp INTEGER;
          ALTER TABLE simulation_runs ADD COLUMN filter_criteria TEXT;
        `, (alterErr) => {
                    // Ignore errors if columns already exist
                    if (alterErr && !alterErr.message.includes('duplicate column name')) {
                        logger_1.logger.warn('Error adding columns to simulation_runs (may already exist)', alterErr);
                    }
                });
                // Create additional indexes
                db.exec(`
          CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON simulation_runs(strategy_name);
          CREATE INDEX IF NOT EXISTS idx_backtest_runs_entry_time ON simulation_runs(entry_timestamp);
        `, (indexErr) => {
                    if (indexErr) {
                        logger_1.logger.warn('Error creating indexes (may already exist)', indexErr);
                    }
                });
                logger_1.logger.info('Database tables created and ready');
                resolve();
            });
        });
    });
}
function saveSimulationRun(data) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const insertRun = `
      INSERT INTO simulation_runs 
      (user_id, mint, chain, token_name, token_symbol, start_time, end_time, strategy, stop_loss_config, final_pnl, total_candles, entry_type, entry_price, entry_timestamp, filter_criteria, strategy_name)
      VALUES ($userId, $mint, $chain, $tokenName, $tokenSymbol, $startTime, $endTime, $strategy, $stopLossConfig, $finalPnl, $totalCandles, $entryType, $entryPrice, $entryTimestamp, $filterCriteria, $strategyName)
    `;
        const runData = {
            $userId: data.userId,
            $mint: data.mint,
            $chain: data.chain,
            $tokenName: data.tokenName ?? 'Unknown',
            $tokenSymbol: data.tokenSymbol ?? 'N/A',
            $startTime: data.startTime.toISO(),
            $endTime: data.endTime.toISO(),
            $strategy: JSON.stringify(data.strategy),
            $stopLossConfig: JSON.stringify(data.stopLossConfig),
            $finalPnl: data.finalPnl,
            $totalCandles: data.totalCandles,
            $entryType: data.entryType || null,
            $entryPrice: data.entryPrice || null,
            $entryTimestamp: data.entryTimestamp || null,
            $filterCriteria: data.filterCriteria ? JSON.stringify(data.filterCriteria) : null,
            $strategyName: data.strategyName || null,
        };
        db.run(insertRun, runData, function (runErr) {
            if (runErr) {
                logger_1.logger.error('Error saving simulation run', runErr);
                return reject(runErr);
            }
            const runId = this.lastID;
            // Save simulation events (if any)
            if (Array.isArray(data.events) && data.events.length > 0) {
                const eventStmt = db.prepare(`
          INSERT INTO simulation_events 
          (run_id, event_type, timestamp, price, description, remaining_position, pnl_so_far)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
                for (const event of data.events) {
                    eventStmt.run([
                        runId,
                        event.type,
                        event.timestamp,
                        event.price,
                        event.description,
                        event.remainingPosition,
                        event.pnlSoFar,
                    ]);
                }
                eventStmt.finalize((err) => {
                    if (err) {
                        logger_1.logger.error('Error saving events', err, { runId });
                        return reject(err);
                    }
                    logger_1.logger.info('Saved simulation run', { runId, eventCount: data.events.length });
                    resolve(runId);
                });
            }
            else {
                resolve(runId);
            }
        });
    });
}
function getUserSimulationRuns(userId, limit = 10) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT 
        id,
        mint,
        chain,
        token_name,
        token_symbol,
        start_time,
        end_time,
        strategy,
        stop_loss_config,
        final_pnl,
        total_candles,
        created_at
      FROM simulation_runs
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
        db.all(query, [userId, limit], async (err, rows) => {
            if (err) {
                logger_1.logger.error('Error fetching simulation runs', err, { userId });
                return reject(err);
            }
            // Fetch events for each run and build complete SimulationRunData
            const runs = await Promise.all(rows.map(async (row) => {
                const events = await getSimulationEvents(row.id).catch(() => []);
                return {
                    id: row.id,
                    mint: row.mint,
                    chain: row.chain,
                    tokenName: row.token_name,
                    tokenSymbol: row.token_symbol,
                    startTime: luxon_1.DateTime.fromISO(row.start_time),
                    endTime: luxon_1.DateTime.fromISO(row.end_time),
                    strategy: JSON.parse(row.strategy),
                    stopLossConfig: JSON.parse(row.stop_loss_config),
                    finalPnl: row.final_pnl,
                    totalCandles: row.total_candles,
                    events: events,
                };
            }));
            resolve(runs);
        });
    });
}
/**
 * Retrieves a simulation run and its details by run ID.
 *
 * @param runId Simulation run identifier
 * @returns {Promise<any|null>}
 */
function getSimulationRun(runId) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT 
        id,
        user_id,
        mint,
        chain,
        token_name,
        token_symbol,
        start_time,
        end_time,
        strategy,
        stop_loss_config,
        strategy_name,
        final_pnl,
        total_candles,
        entry_type,
        entry_price,
        entry_timestamp,
        filter_criteria,
        created_at
      FROM simulation_runs
      WHERE id = ?
    `;
        db.get(query, [runId], (err, row) => {
            if (err) {
                logger_1.logger.error('Error fetching simulation run', err, { runId });
                return reject(err);
            }
            if (!row)
                return resolve(null);
            const run = {
                id: row.id,
                userId: row.user_id,
                mint: row.mint,
                chain: row.chain,
                tokenName: row.token_name,
                tokenSymbol: row.token_symbol,
                startTime: row.start_time,
                endTime: row.end_time,
                strategy: JSON.parse(row.strategy),
                stopLossConfig: JSON.parse(row.stop_loss_config),
                strategyName: row.strategy_name,
                finalPnl: row.final_pnl,
                totalCandles: row.total_candles,
                entryType: row.entry_type,
                entryPrice: row.entry_price,
                entryTimestamp: row.entry_timestamp,
                filterCriteria: row.filter_criteria ? JSON.parse(row.filter_criteria) : null,
                createdAt: luxon_1.DateTime.fromISO(row.created_at),
            };
            resolve(run);
        });
    });
}
/**
 * Retrieves all events for a specific simulation run.
 *
 * @param runId Simulation run identifier
 * @returns {Promise<any[]>}
 */
function getSimulationEvents(runId) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT 
        event_type,
        timestamp,
        price,
        description,
        remaining_position,
        pnl_so_far
      FROM simulation_events
      WHERE run_id = ?
      ORDER BY timestamp ASC
    `;
        db.all(query, [runId], (err, rows) => {
            if (err) {
                logger_1.logger.error('Error fetching simulation events', err, { runId });
                return reject(err);
            }
            resolve(rows ?? []);
        });
    });
}
// ---------------------------------------------------------------------
// 3. Strategy Management
// ---------------------------------------------------------------------
/**
 * Persists a user-defined simulation strategy to the database, replacing any existing with same name.
 *
 * @param data Strategy data object
 * @returns {Promise<number>} The inserted (or replaced) strategy's ID
 */
function saveStrategy(data) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const insertStrategy = `
      INSERT OR REPLACE INTO strategies
      (user_id, name, description, strategy, stop_loss_config, is_default)
      VALUES ($userId, $name, $description, $strategy, $stopLossConfig, $isDefault)
    `;
        const strategyData = {
            $userId: data.userId,
            $name: data.name,
            $description: data.description ?? '',
            $strategy: JSON.stringify(data.strategy),
            $stopLossConfig: JSON.stringify(data.stopLossConfig),
            $isDefault: data.isDefault ? 1 : 0,
        };
        db.run(insertStrategy, strategyData, function (err) {
            if (err) {
                logger_1.logger.error('Error saving strategy', err, { userId: data.userId, strategyName: data.name });
                return reject(err);
            }
            logger_1.logger.info('Saved strategy', { userId: data.userId, strategyName: data.name });
            resolve(this.lastID);
        });
    });
}
/**
 * Fetches all strategies defined by a specific user, newest first.
 *
 * @param userId User's identifier
 * @returns {Promise<any[]>}
 */
function getUserStrategies(userId) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT
        id,
        name,
        description,
        strategy,
        stop_loss_config,
        is_default,
        created_at
      FROM strategies
      WHERE user_id = ?
      ORDER BY is_default DESC, created_at DESC
    `;
        db.all(query, [userId], (err, rows) => {
            if (err) {
                logger_1.logger.error('Error fetching strategies', err, { userId });
                return reject(err);
            }
            const strategies = (rows ?? []).map((row) => ({
                ...row,
                strategy: JSON.parse(row.strategy),
                stopLossConfig: JSON.parse(row.stop_loss_config),
                createdAt: luxon_1.DateTime.fromISO(row.created_at),
            }));
            resolve(strategies);
        });
    });
}
/**
 * Fetches a specific strategy by user and strategy name.
 *
 * @param userId User's identifier
 * @param name Strategy name (unique per user)
 * @returns {Promise<any|null>}
 */
function getStrategy(userId, name) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT
        id,
        name,
        description,
        strategy,
        stop_loss_config,
        is_default,
        created_at
      FROM strategies
      WHERE user_id = ? AND name = ?
    `;
        db.get(query, [userId, name], (err, row) => {
            if (err) {
                logger_1.logger.error('Error fetching strategy', err, { userId, strategyName: name });
                return reject(err);
            }
            if (!row)
                return resolve(null);
            resolve({
                ...row,
                strategy: JSON.parse(row.strategy),
                stopLossConfig: JSON.parse(row.stop_loss_config),
                createdAt: luxon_1.DateTime.fromISO(row.created_at),
            });
        });
    });
}
/**
 * Deletes a user's strategy by name.
 *
 * @param userId User's identifier
 * @param name Strategy name to delete
 * @returns {Promise<void>}
 */
function deleteStrategy(userId, name) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `DELETE FROM strategies WHERE user_id = ? AND name = ?`;
        db.run(query, [userId, name], function (err) {
            if (err) {
                logger_1.logger.error('Error deleting strategy', err, { userId, strategyName: name });
                return reject(err);
            }
            if (this.changes === 0) {
                return reject(new Error('Strategy not found'));
            }
            logger_1.logger.info('Deleted strategy', { userId, strategyName: name });
            resolve();
        });
    });
}
// ---------------------------------------------------------------------
// 4. CA Tracking & Alerts
// ---------------------------------------------------------------------
/**
 * Saves a new CA drop for auto-tracking by the CA system.
 *
 * @param data CA drop and associated strategy configuration details
 * @returns {Promise<number>} The inserted CA tracking entry's ID
 */
function saveCADrop(data) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const insertCA = `
      INSERT INTO ca_tracking
      (user_id, chat_id, mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, strategy, stop_loss_config)
      VALUES ($userId, $chatId, $mint, $chain, $tokenName, $tokenSymbol, $callPrice, $callMarketcap, $callTimestamp, $strategy, $stopLossConfig)
    `;
        const caData = {
            $userId: data.userId,
            $chatId: data.chatId,
            $mint: data.mint,
            $chain: data.chain,
            $tokenName: data.tokenName ?? 'Unknown',
            $tokenSymbol: data.tokenSymbol ?? 'N/A',
            $callPrice: data.callPrice,
            $callMarketcap: data.callMarketcap ?? 0,
            $callTimestamp: data.callTimestamp,
            $strategy: JSON.stringify(data.strategy),
            $stopLossConfig: JSON.stringify(data.stopLossConfig),
        };
        db.run(insertCA, caData, function (err) {
            if (err) {
                logger_1.logger.error('Error saving CA drop', err, { userId: data.userId, mint: data.mint });
                return reject(err);
            }
            logger_1.logger.info('Saved CA drop', { userId: data.userId, mint: data.mint });
            resolve(this.lastID);
        });
    });
}
/**
 * Returns all currently active CA tracking entries, with fully parsed config fields.
 *
 * @returns {Promise<any[]>}
 */
function getActiveCATracking() {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT
        id,
        user_id,
        chat_id,
        mint,
        chain,
        token_name,
        token_symbol,
        call_price,
        call_marketcap,
        call_timestamp,
        strategy,
        stop_loss_config,
        created_at
      FROM ca_tracking
      WHERE is_active = 1
      ORDER BY created_at DESC
    `;
        db.all(query, [], (err, rows) => {
            if (err) {
                logger_1.logger.error('Error fetching active CA tracking', err);
                return reject(err);
            }
            const cases = (rows ?? []).map((row) => ({
                ...row,
                strategy: JSON.parse(row.strategy),
                stopLossConfig: JSON.parse(row.stop_loss_config),
                createdAt: luxon_1.DateTime.fromISO(row.created_at),
            }));
            resolve(cases);
        });
    });
}
function upsertPumpfunToken(record) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      INSERT INTO pumpfun_tokens
      (mint, creator, bonding_curve, launch_signature, launch_timestamp, graduation_signature, graduation_timestamp, is_graduated, metadata, updated_at)
      VALUES ($mint, $creator, $bondingCurve, $launchSignature, $launchTimestamp, $graduationSignature, $graduationTimestamp, $isGraduated, $metadata, CURRENT_TIMESTAMP)
      ON CONFLICT(mint) DO UPDATE SET
        creator=excluded.creator,
        bonding_curve=excluded.bonding_curve,
        launch_signature=excluded.launch_signature,
        launch_timestamp=excluded.launch_timestamp,
        graduation_signature=COALESCE(excluded.graduation_signature, pumpfun_tokens.graduation_signature),
        graduation_timestamp=COALESCE(excluded.graduation_timestamp, pumpfun_tokens.graduation_timestamp),
        is_graduated=excluded.is_graduated,
        metadata=excluded.metadata,
        updated_at=CURRENT_TIMESTAMP
    `;
        const params = {
            $mint: record.mint,
            $creator: record.creator ?? null,
            $bondingCurve: record.bondingCurve ?? null,
            $launchSignature: record.launchSignature ?? null,
            $launchTimestamp: record.launchTimestamp ?? null,
            $graduationSignature: record.graduationSignature ?? null,
            $graduationTimestamp: record.graduationTimestamp ?? null,
            $isGraduated: record.isGraduated ? 1 : 0,
            $metadata: record.metadata ? JSON.stringify(record.metadata) : null,
        };
        db.run(query, params, (err) => {
            if (err) {
                logger_1.logger.error('Error upserting Pump.fun token', err, { mint: record.mint });
                return reject(err);
            }
            resolve();
        });
    });
}
function markPumpfunGraduated(mint, data) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      UPDATE pumpfun_tokens
      SET is_graduated = 1,
          graduation_signature = COALESCE($graduationSignature, graduation_signature),
          graduation_timestamp = COALESCE($graduationTimestamp, graduation_timestamp),
          updated_at = CURRENT_TIMESTAMP
      WHERE mint = $mint
    `;
        db.run(query, {
            $mint: mint,
            $graduationSignature: data.graduationSignature ?? null,
            $graduationTimestamp: data.graduationTimestamp ?? null,
        }, function (err) {
            if (err) {
                logger_1.logger.error('Error marking Pump.fun token graduated', err, { mint });
                return reject(err);
            }
            resolve();
        });
    });
}
function getPumpfunTokenRecords() {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      SELECT mint, creator, bonding_curve, launch_signature, launch_timestamp,
             graduation_signature, graduation_timestamp, is_graduated, metadata
      FROM pumpfun_tokens
    `;
        db.all(query, [], (err, rows) => {
            if (err) {
                logger_1.logger.error('Error fetching Pump.fun tokens', err);
                return reject(err);
            }
            const records = (rows ?? []).map((row) => ({
                mint: row.mint,
                creator: row.creator ?? undefined,
                bondingCurve: row.bonding_curve ?? undefined,
                launchSignature: row.launch_signature ?? undefined,
                launchTimestamp: row.launch_timestamp ?? undefined,
                graduationSignature: row.graduation_signature ?? undefined,
                graduationTimestamp: row.graduation_timestamp ?? undefined,
                isGraduated: Boolean(row.is_graduated),
                metadata: row.metadata ? JSON.parse(row.metadata) : null,
            }));
            resolve(records);
        });
    });
}
function getTrackedTokens() {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const caQuery = `
      SELECT mint, chain, token_name, token_symbol, call_timestamp
      FROM ca_tracking
      WHERE is_active = 1
    `;
        const tokenQuery = `
      SELECT mint, chain, token_name, token_symbol, created_at
      FROM tokens
    `;
        db.all(caQuery, [], (caErr, caRows) => {
            if (caErr) {
                logger_1.logger.error('Error fetching CA tracked tokens', caErr);
                return reject(caErr);
            }
            db.all(tokenQuery, [], async (tokenErr, tokenRows) => {
                if (tokenErr) {
                    logger_1.logger.error('Error fetching token registry', tokenErr);
                    return reject(tokenErr);
                }
                try {
                    const pumpfunTokens = await getPumpfunTokenRecords();
                    const combined = new Map();
                    (caRows ?? []).forEach((row) => {
                        const key = `${row.chain}:${row.mint}`;
                        combined.set(key, {
                            mint: row.mint,
                            chain: row.chain,
                            tokenName: row.token_name ?? undefined,
                            tokenSymbol: row.token_symbol ?? undefined,
                            firstSeen: row.call_timestamp ? Number(row.call_timestamp) : undefined,
                            source: 'ca_tracking',
                        });
                    });
                    (tokenRows ?? []).forEach((row) => {
                        const key = `${row.chain}:${row.mint}`;
                        if (combined.has(key)) {
                            return;
                        }
                        const createdAt = row.created_at ? luxon_1.DateTime.fromISO(row.created_at).toSeconds() : undefined;
                        combined.set(key, {
                            mint: row.mint,
                            chain: row.chain,
                            tokenName: row.token_name ?? undefined,
                            tokenSymbol: row.token_symbol ?? undefined,
                            firstSeen: createdAt,
                            source: 'token_registry',
                        });
                    });
                    pumpfunTokens.forEach((token) => {
                        const key = `solana:${token.mint}`;
                        const source = token.isGraduated ? 'pumpfun_graduated' : 'pumpfun_launch';
                        if (!combined.has(key)) {
                            combined.set(key, {
                                mint: token.mint,
                                chain: 'solana',
                                firstSeen: token.launchTimestamp,
                                tokenName: token.metadata?.name ?? undefined,
                                tokenSymbol: token.metadata?.symbol ?? undefined,
                                source,
                            });
                        }
                    });
                    resolve(Array.from(combined.values()));
                }
                catch (pumpErr) {
                    reject(pumpErr);
                }
            });
        });
    });
}
/**
 * Save a price update for a tracked CA.
 *
 * @param caId ID of the CA tracking row
 * @param price Price value
 * @param marketcap Marketcap value
 * @param timestamp Update timestamp (seconds)
 * @returns {Promise<void>}
 */
function savePriceUpdate(caId, price, marketcap, timestamp) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      INSERT INTO price_updates (ca_id, price, marketcap, timestamp)
      VALUES (?, ?, ?, ?)
    `;
        db.run(query, [caId, price, marketcap, timestamp], function (err) {
            if (err) {
                logger_1.logger.error('Error saving price update', err, { caId });
                return reject(err);
            }
            resolve();
        });
    });
}
/**
 * Save an alert that was sent to a user for a CA.
 *
 * @param caId CA tracking row ID
 * @param alertType Type of alert
 * @param price The current price
 * @param timestamp Alert timestamp (seconds)
 * @returns {Promise<void>}
 */
function saveAlertSent(caId, alertType, price, timestamp) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const query = `
      INSERT INTO alerts_sent (ca_id, alert_type, price, timestamp)
      VALUES (?, ?, ?, ?)
    `;
        db.run(query, [caId, alertType, price, timestamp], function (err) {
            if (err) {
                logger_1.logger.error('Error saving alert', err, { caId, alertType });
                return reject(err);
            }
            resolve();
        });
    });
}
/**
 * Get summary of recent CA performances over the past `hours`.
 *
 * @param hours How many hours back to look (default: 24)
 * @returns {Promise<any[]>}
 */
function getRecentCAPerformance(hours = 24) {
    return new Promise((resolve, reject) => {
        if (!db)
            return reject(new Error('Database not initialized'));
        const cutoffTime = luxon_1.DateTime.now().minus({ hours }).toSeconds();
        const query = `
      SELECT 
        ca.id,
        ca.mint,
        ca.chain,
        ca.token_name,
        ca.token_symbol,
        ca.call_price,
        ca.call_timestamp,
        ca.strategy,
        ca.stop_loss_config,
        pu.price as current_price,
        pu.timestamp as price_timestamp
      FROM ca_tracking ca
      LEFT JOIN price_updates pu ON ca.id = pu.ca_id
      WHERE ca.call_timestamp > ? AND ca.is_active = 1
      ORDER BY pu.timestamp DESC
    `;
        db.all(query, [cutoffTime], (err, rows) => {
            if (err) {
                logger_1.logger.error('Error fetching CA performance', err, { hours });
                return reject(err);
            }
            // Group by CA id, picking latest price for each
            const caMap = new Map();
            (rows ?? []).forEach((row) => {
                if (!caMap.has(row.id)) {
                    caMap.set(row.id, {
                        ...row,
                        strategy: JSON.parse(row.strategy),
                        stopLossConfig: JSON.parse(row.stop_loss_config),
                        currentPrice: row.current_price || row.call_price,
                        priceTimestamp: row.price_timestamp || row.call_timestamp,
                    });
                }
            });
            resolve(Array.from(caMap.values()));
        });
    });
}
async function getAllCACalls(limit = 50) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        const sql = `
      SELECT 
        mint,
        chain,
        token_name,
        token_symbol,
        call_price,
        call_marketcap,
        call_timestamp,
        caller,
        created_at
      FROM ca_calls 
      ORDER BY call_timestamp DESC 
      LIMIT ?
    `;
        db.all(sql, [limit], (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve((rows || []));
        });
    });
}
/**
 * Get a specific CA call by mint address
 * @param mint The mint address to search for
 * @returns CA call object or null if not found
 */
async function getCACallByMint(mint) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        const sql = `
      SELECT 
        mint,
        chain,
        token_name,
        token_symbol,
        call_price,
        call_marketcap,
        call_timestamp,
        caller,
        created_at
      FROM ca_calls 
      WHERE mint = ?
      ORDER BY call_timestamp DESC 
      LIMIT 1
    `;
        db.get(sql, [mint], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row || null);
        });
    });
}
/**
 * Get CA calls by caller
 * @param caller The caller name to search for
 * @param limit Maximum number of calls to return
 * @returns Array of CA call objects
 */
async function getCACallsByCaller(caller, limit = 20) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        const sql = `
      SELECT 
        mint,
        chain,
        token_name,
        token_symbol,
        call_price,
        call_marketcap,
        call_timestamp,
        caller,
        created_at
      FROM ca_calls 
      WHERE caller = ?
      ORDER BY call_timestamp DESC 
      LIMIT ?
    `;
        db.all(sql, [caller, limit], (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}
/**
 * Get CA calls by chain
 * @param chain The chain to search for
 * @param limit Maximum number of calls to return
 * @returns Array of CA call objects
 */
async function getCACallsByChain(chain, limit = 20) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        const sql = `
      SELECT 
        mint,
        chain,
        token_name,
        token_symbol,
        call_price,
        call_marketcap,
        call_timestamp,
        caller,
        created_at
      FROM ca_calls 
      WHERE chain = ?
      ORDER BY call_timestamp DESC 
      LIMIT ?
    `;
        db.all(sql, [chain, limit], (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(rows || []);
        });
    });
}
/**
 * Save a CA call to the historical calls table
 * @param callData The CA call data to save
 * @returns Promise<number> The ID of the inserted call
 */
async function saveCACall(callData) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('Database not initialized'));
            return;
        }
        const sql = `
      INSERT OR IGNORE INTO ca_calls 
      (mint, chain, token_name, token_symbol, call_price, call_marketcap, call_timestamp, caller, source_chat_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
        db.run(sql, [
            callData.mint,
            callData.chain,
            callData.tokenName || null,
            callData.tokenSymbol || null,
            callData.callPrice || null,
            callData.callMarketcap || null,
            callData.callTimestamp,
            callData.caller || null,
            callData.sourceChatId || null
        ], function (err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this.lastID);
        });
    });
}
// ---------------------------------------------------------------------
// 6. Utility Functions
// ---------------------------------------------------------------------
/**
 * Gracefully closes the database connection if open.
 *
 * @returns {Promise<void>}
 */
function closeDatabase() {
    return new Promise((resolve) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    logger_1.logger.error('Error closing database', err);
                }
                else {
                    logger_1.logger.info('Database connection closed');
                }
                resolve();
            });
        }
        else {
            resolve();
        }
    });
}
//# sourceMappingURL=database.js.map