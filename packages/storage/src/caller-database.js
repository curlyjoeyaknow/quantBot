"use strict";
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
exports.callerDatabase = exports.CallerDatabase = void 0;
const sqlite3_1 = require("sqlite3");
const util_1 = require("util");
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
const utils_1 = require("@quantbot/utils");
(0, dotenv_1.config)();
class CallerDatabase {
    constructor(dbPath = process.env.CALLER_DB_PATH || path.join(process.cwd(), 'data', 'databases', 'caller_alerts.db')) {
        this.dbPath = dbPath;
        this.db = new sqlite3_1.Database(dbPath);
        this.initDatabase();
    }
    /**
     * Initialize database tables
     */
    async initDatabase() {
        const run = (0, util_1.promisify)(this.db.run.bind(this.db));
        try {
            // Create caller_alerts table
            await run(`
        CREATE TABLE IF NOT EXISTS caller_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          caller_name TEXT NOT NULL,
          token_address TEXT NOT NULL,
          token_symbol TEXT,
          chain TEXT NOT NULL DEFAULT 'solana',
          alert_timestamp DATETIME NOT NULL,
          alert_message TEXT,
          price_at_alert REAL,
          volume_at_alert REAL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(caller_name, token_address, alert_timestamp)
        )
      `);
            // Create indexes for better query performance
            await run(`CREATE INDEX IF NOT EXISTS idx_caller_name ON caller_alerts(caller_name)`);
            await run(`CREATE INDEX IF NOT EXISTS idx_token_address ON caller_alerts(token_address)`);
            await run(`CREATE INDEX IF NOT EXISTS idx_alert_timestamp ON caller_alerts(alert_timestamp)`);
            await run(`CREATE INDEX IF NOT EXISTS idx_caller_timestamp ON caller_alerts(caller_name, alert_timestamp)`);
            // Create caller_stats table for aggregated statistics
            await run(`
        CREATE TABLE IF NOT EXISTS caller_stats (
          caller_name TEXT PRIMARY KEY,
          total_alerts INTEGER NOT NULL,
          unique_tokens INTEGER NOT NULL,
          first_alert DATETIME NOT NULL,
          last_alert DATETIME NOT NULL,
          avg_alerts_per_day REAL NOT NULL,
          success_rate REAL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
            utils_1.logger.info('Caller database initialized successfully');
        }
        catch (error) {
            utils_1.logger.error('Failed to initialize caller database', error);
            throw error;
        }
    }
    /**
     * Add a new caller alert
     */
    async addCallerAlert(alert) {
        const run = (0, util_1.promisify)(this.db.run.bind(this.db));
        try {
            const result = await run(`
        INSERT OR IGNORE INTO caller_alerts 
        (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
                alert.callerName,
                alert.tokenAddress.toLowerCase(),
                alert.tokenSymbol,
                alert.chain,
                alert.alertTimestamp.toISOString(),
                alert.alertMessage,
                alert.priceAtAlert,
                alert.volumeAtAlert
            ]);
            return result.lastID;
        }
        catch (error) {
            utils_1.logger.error('Failed to add caller alert', error, { callerName: alert.callerName, tokenAddress: alert.tokenAddress });
            throw error;
        }
    }
    /**
     * Batch add multiple caller alerts
     */
    async addCallerAlertsBatch(alerts) {
        const run = (0, util_1.promisify)(this.db.run.bind(this.db));
        try {
            const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO caller_alerts 
        (caller_name, token_address, token_symbol, chain, alert_timestamp, alert_message, price_at_alert, volume_at_alert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            let addedCount = 0;
            for (const alert of alerts) {
                try {
                    await new Promise((resolve, reject) => {
                        stmt.run([
                            alert.callerName,
                            alert.tokenAddress.toLowerCase(),
                            alert.tokenSymbol,
                            alert.chain,
                            alert.alertTimestamp.toISOString(),
                            alert.alertMessage,
                            alert.priceAtAlert,
                            alert.volumeAtAlert
                        ], function (err) {
                            if (err)
                                reject(err);
                            else {
                                if (this.changes > 0)
                                    addedCount++;
                                resolve(this);
                            }
                        });
                    });
                }
                catch (error) {
                    // Skip duplicates silently
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (!errorMessage.includes('UNIQUE constraint failed')) {
                        utils_1.logger.warn('Failed to add alert', { callerName: alert.callerName, error: errorMessage });
                    }
                }
            }
            stmt.finalize();
            utils_1.logger.info('Added caller alerts', { addedCount, totalCount: alerts.length });
            return addedCount;
        }
        catch (error) {
            utils_1.logger.error('Failed to batch add caller alerts', error);
            throw error;
        }
    }
    /**
     * Get all alerts for a specific caller
     */
    async getCallerAlerts(callerName, limit) {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const query = limit
                ? `SELECT * FROM caller_alerts WHERE caller_name = ? ORDER BY alert_timestamp DESC LIMIT ?`
                : `SELECT * FROM caller_alerts WHERE caller_name = ? ORDER BY alert_timestamp DESC`;
            const params = limit ? [callerName, limit] : [callerName];
            const rows = await all(query, params);
            return rows.map((row) => ({
                id: row.id,
                callerName: row.caller_name,
                tokenAddress: row.token_address,
                tokenSymbol: row.token_symbol,
                chain: row.chain,
                alertTimestamp: new Date(row.alert_timestamp),
                alertMessage: row.alert_message,
                priceAtAlert: row.price_at_alert,
                volumeAtAlert: row.volume_at_alert,
                createdAt: new Date(row.created_at)
            }));
        }
        catch (error) {
            utils_1.logger.error('Failed to get caller alerts', error, { callerName });
            throw error;
        }
    }
    /**
     * Get alerts for a caller within a time range
     */
    async getCallerAlertsInRange(callerName, startTime, endTime) {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const rows = await all(`
        SELECT * FROM caller_alerts 
        WHERE caller_name = ? 
        AND alert_timestamp >= ? 
        AND alert_timestamp <= ?
        ORDER BY alert_timestamp ASC
      `, [callerName, startTime.toISOString(), endTime.toISOString()]);
            return rows.map((row) => ({
                id: row.id,
                callerName: row.caller_name,
                tokenAddress: row.token_address,
                tokenSymbol: row.token_symbol,
                chain: row.chain,
                alertTimestamp: new Date(row.alert_timestamp),
                alertMessage: row.alert_message,
                priceAtAlert: row.price_at_alert,
                volumeAtAlert: row.volume_at_alert,
                createdAt: new Date(row.created_at)
            }));
        }
        catch (error) {
            utils_1.logger.error('Failed to get caller alerts in range', error, { callerName, startTime: startTime?.toISOString(), endTime: endTime?.toISOString() });
            throw error;
        }
    }
    /**
     * Get all unique callers
     */
    async getAllCallers() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const rows = await all(`SELECT DISTINCT caller_name FROM caller_alerts ORDER BY caller_name`);
            return rows.map((row) => row.caller_name);
        }
        catch (error) {
            utils_1.logger.error('Failed to get all callers', error);
            throw error;
        }
    }
    /**
     * Get caller statistics
     */
    async getCallerStats(callerName) {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const rows = await all(`
        SELECT 
          caller_name,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert,
          COUNT(*) * 1.0 / (julianday(MAX(alert_timestamp)) - julianday(MIN(alert_timestamp)) + 1) as avg_alerts_per_day
        FROM caller_alerts 
        WHERE caller_name = ?
        GROUP BY caller_name
      `, [callerName]);
            if (rows.length === 0)
                return null;
            const row = rows[0];
            return {
                callerName: row.caller_name,
                totalAlerts: row.total_alerts,
                uniqueTokens: row.unique_tokens,
                firstAlert: new Date(row.first_alert),
                lastAlert: new Date(row.last_alert),
                avgAlertsPerDay: parseFloat(row.avg_alerts_per_day.toFixed(2))
            };
        }
        catch (error) {
            utils_1.logger.error('Failed to get caller stats', error, { callerName });
            throw error;
        }
    }
    /**
     * Get all caller statistics
     */
    async getAllCallerStats() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const rows = await all(`
        SELECT 
          caller_name,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert,
          COUNT(*) * 1.0 / (julianday(MAX(alert_timestamp)) - julianday(MIN(alert_timestamp)) + 1) as avg_alerts_per_day
        FROM caller_alerts 
        GROUP BY caller_name
        ORDER BY total_alerts DESC
      `);
            return rows.map((row) => ({
                callerName: row.caller_name,
                totalAlerts: row.total_alerts,
                uniqueTokens: row.unique_tokens,
                firstAlert: new Date(row.first_alert),
                lastAlert: new Date(row.last_alert),
                avgAlertsPerDay: parseFloat(row.avg_alerts_per_day.toFixed(2))
            }));
        }
        catch (error) {
            utils_1.logger.error('Failed to get all caller stats', error);
            throw error;
        }
    }
    /**
     * Get tokens called by a specific caller
     */
    async getCallerTokens(callerName) {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const rows = await all(`
        SELECT 
          token_address,
          token_symbol,
          chain,
          COUNT(*) as alert_count
        FROM caller_alerts 
        WHERE caller_name = ?
        GROUP BY token_address, token_symbol, chain
        ORDER BY alert_count DESC
      `, [callerName]);
            return rows.map((row) => ({
                tokenAddress: row.token_address,
                tokenSymbol: row.token_symbol,
                chain: row.chain,
                alertCount: row.alert_count
            }));
        }
        catch (error) {
            utils_1.logger.error('Failed to get caller tokens', error, { callerName });
            throw error;
        }
    }
    /**
     * Update caller success rate (called after simulations)
     */
    async updateCallerSuccessRate(callerName, successRate) {
        const run = (0, util_1.promisify)(this.db.run.bind(this.db));
        try {
            await run(`
        INSERT OR REPLACE INTO caller_stats 
        (caller_name, total_alerts, unique_tokens, first_alert, last_alert, avg_alerts_per_day, success_rate, updated_at)
        SELECT 
          caller_name,
          COUNT(*) as total_alerts,
          COUNT(DISTINCT token_address) as unique_tokens,
          MIN(alert_timestamp) as first_alert,
          MAX(alert_timestamp) as last_alert,
          COUNT(*) * 1.0 / (julianday(MAX(alert_timestamp)) - julianday(MIN(alert_timestamp)) + 1) as avg_alerts_per_day,
          ? as success_rate,
          CURRENT_TIMESTAMP as updated_at
        FROM caller_alerts 
        WHERE caller_name = ?
        GROUP BY caller_name
      `, [successRate, callerName]);
            utils_1.logger.info('Updated caller success rate', { callerName, successRate: successRate.toFixed(2) });
        }
        catch (error) {
            utils_1.logger.error('Failed to update caller success rate', error, { callerName });
            throw error;
        }
    }
    /**
     * Get database statistics
     */
    async getDatabaseStats() {
        const all = (0, util_1.promisify)(this.db.all.bind(this.db));
        try {
            const rows = await all(`
        SELECT 
          COUNT(*) as total_alerts,
          COUNT(DISTINCT caller_name) as total_callers,
          COUNT(DISTINCT token_address) as total_tokens,
          MIN(alert_timestamp) as earliest_alert,
          MAX(alert_timestamp) as latest_alert
        FROM caller_alerts
      `);
            const row = rows[0];
            return {
                totalAlerts: row.total_alerts,
                totalCallers: row.total_callers,
                totalTokens: row.total_tokens,
                dateRange: {
                    start: new Date(row.earliest_alert),
                    end: new Date(row.latest_alert)
                }
            };
        }
        catch (error) {
            utils_1.logger.error('Failed to get database stats', error);
            throw error;
        }
    }
    /**
     * Close database connection
     */
    async close() {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err)
                    reject(err);
                else {
                    utils_1.logger.info('Caller database connection closed');
                    resolve();
                }
            });
        });
    }
}
exports.CallerDatabase = CallerDatabase;
// Export singleton instance
exports.callerDatabase = new CallerDatabase();
//# sourceMappingURL=caller-database.js.map