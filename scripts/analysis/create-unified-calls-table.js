"use strict";
/**
 * Create a unified caller-free SQLite table containing all calls from all callers
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
exports.UNIFIED_DB_PATH = void 0;
exports.initUnifiedDatabase = initUnifiedDatabase;
const sqlite3_1 = require("sqlite3");
const util_1 = require("util");
const dotenv_1 = require("dotenv");
const logger_1 = require("../../src/utils/logger");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
(0, dotenv_1.config)();
const DB_PATH = process.env.CALLER_DB_PATH || path.join(process.cwd(), 'data', 'caller_alerts.db');
const UNIFIED_DB_PATH = path.join(process.cwd(), 'data', 'unified_calls.db');
exports.UNIFIED_DB_PATH = UNIFIED_DB_PATH;
// Callers to exclude (bots)
const EXCLUDED_CALLERS = [
    'Phanes [Gold]',
    'Rick',
    // Case-insensitive matching patterns
    'phanes',
    'rick',
];
/**
 * Initialize unified calls database
 */
async function initUnifiedDatabase() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3_1.Database(UNIFIED_DB_PATH, (err) => {
            if (err) {
                logger_1.logger.error('Failed to open unified database', err);
                return reject(err);
            }
        });
        const run = (0, util_1.promisify)(db.run.bind(db));
        run(`
      CREATE TABLE IF NOT EXISTS unified_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_address TEXT NOT NULL,
        token_symbol TEXT,
        chain TEXT NOT NULL DEFAULT 'solana',
        call_timestamp INTEGER NOT NULL,
        price_at_call REAL,
        volume_at_call REAL,
        market_cap_at_call REAL,
        caller_name TEXT NOT NULL,
        source TEXT NOT NULL,
        original_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(token_address, call_timestamp, caller_name)
      )
    `)
            .then(() => run(`CREATE INDEX IF NOT EXISTS idx_token_address ON unified_calls(token_address)`))
            .then(() => run(`CREATE INDEX IF NOT EXISTS idx_call_timestamp ON unified_calls(call_timestamp)`))
            .then(() => run(`CREATE INDEX IF NOT EXISTS idx_caller_name ON unified_calls(caller_name)`))
            .then(() => run(`CREATE INDEX IF NOT EXISTS idx_token_timestamp ON unified_calls(token_address, call_timestamp)`))
            .then(() => {
            logger_1.logger.info('Unified database initialized');
            resolve(db);
        })
            .catch(reject);
    });
}
/**
 * Extract calls from caller_alerts table
 */
async function extractCallerAlerts(sourceDb) {
    return new Promise((resolve, reject) => {
        const all = (0, util_1.promisify)(sourceDb.all.bind(sourceDb));
        all(`
      SELECT 
        id,
        caller_name,
        token_address,
        token_symbol,
        chain,
        alert_timestamp,
        price_at_alert,
        volume_at_alert
      FROM caller_alerts
      ORDER BY alert_timestamp ASC
    `)
            .then((rows) => {
            const calls = rows
                .filter(row => {
                // Filter out excluded callers (case-insensitive)
                const callerName = (row.caller_name || '').toLowerCase();
                return !EXCLUDED_CALLERS.some(excluded => callerName.includes(excluded.toLowerCase()));
            })
                .map(row => {
                // Parse timestamp
                let timestamp;
                if (typeof row.alert_timestamp === 'string') {
                    timestamp = new Date(row.alert_timestamp);
                }
                else {
                    timestamp = new Date(row.alert_timestamp);
                }
                return {
                    tokenAddress: row.token_address,
                    tokenSymbol: row.token_symbol,
                    chain: row.chain || 'solana',
                    callTimestamp: timestamp,
                    priceAtCall: row.price_at_alert,
                    volumeAtCall: row.volume_at_alert,
                    callerName: row.caller_name,
                    source: 'caller_alerts',
                    originalId: row.id,
                };
            });
            logger_1.logger.info('Extracted calls from caller_alerts', { count: calls.length });
            resolve(calls);
        })
            .catch(reject);
    });
}
/**
 * Check if table exists
 */
async function tableExists(db, tableName) {
    return new Promise((resolve, reject) => {
        const all = (0, util_1.promisify)(db.all.bind(db));
        all(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name=?
    `, [tableName])
            .then((rows) => resolve(rows.length > 0))
            .catch(reject);
    });
}
/**
 * Extract calls from ca_calls table
 */
async function extractCACalls(sourceDb) {
    // Check if table exists first
    const exists = await tableExists(sourceDb, 'ca_calls');
    if (!exists) {
        logger_1.logger.info('ca_calls table does not exist, skipping');
        return [];
    }
    return new Promise((resolve, reject) => {
        const all = (0, util_1.promisify)(sourceDb.all.bind(sourceDb));
        all(`
      SELECT 
        id,
        caller,
        mint as token_address,
        token_symbol,
        chain,
        call_timestamp,
        call_price as price_at_call,
        call_marketcap as market_cap_at_call
      FROM ca_calls
      ORDER BY call_timestamp ASC
    `)
            .then((rows) => {
            const calls = rows
                .filter(row => {
                // Filter out excluded callers (case-insensitive)
                const callerName = ((row.caller || 'unknown') || '').toLowerCase();
                return !EXCLUDED_CALLERS.some(excluded => callerName.includes(excluded.toLowerCase()));
            })
                .map(row => {
                // Parse timestamp
                let timestamp = null;
                if (typeof row.call_timestamp === 'number') {
                    timestamp = new Date(row.call_timestamp * 1000);
                }
                else if (typeof row.call_timestamp === 'string') {
                    timestamp = new Date(row.call_timestamp);
                }
                if (!timestamp || isNaN(timestamp.getTime())) {
                    return null;
                }
                const call = {
                    tokenAddress: row.token_address,
                    tokenSymbol: row.token_symbol,
                    chain: row.chain || 'solana',
                    callTimestamp: timestamp,
                    priceAtCall: row.price_at_call,
                    marketCapAtCall: row.market_cap_at_call,
                    callerName: row.caller || 'unknown',
                    source: 'ca_calls',
                    originalId: row.id,
                };
                return call;
            })
                .filter((call) => call !== null);
            logger_1.logger.info('Extracted calls from ca_calls', { count: calls.length });
            resolve(calls);
        })
            .catch(reject);
    });
}
/**
 * Insert calls into unified database
 */
async function insertCalls(db, calls) {
    const run = (0, util_1.promisify)(db.run.bind(db));
    const all = (0, util_1.promisify)(db.all.bind(db));
    let inserted = 0;
    let skipped = 0;
    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < calls.length; i += batchSize) {
        const batch = calls.slice(i, i + batchSize);
        for (const call of batch) {
            try {
                const timestampUnix = Math.floor(call.callTimestamp.getTime() / 1000);
                await run(`
          INSERT OR IGNORE INTO unified_calls 
          (token_address, token_symbol, chain, call_timestamp, price_at_call, volume_at_call, market_cap_at_call, caller_name, source, original_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
                    call.tokenAddress, // Keep case-sensitive
                    call.tokenSymbol,
                    call.chain,
                    timestampUnix,
                    call.priceAtCall,
                    call.volumeAtCall,
                    call.marketCapAtCall,
                    call.callerName,
                    call.source,
                    call.originalId,
                ]);
                inserted++;
            }
            catch (error) {
                if (error.message?.includes('UNIQUE constraint')) {
                    skipped++;
                }
                else {
                    logger_1.logger.warn('Failed to insert call', {
                        tokenAddress: call.tokenAddress.substring(0, 20),
                        error: error.message,
                    });
                }
            }
        }
        if ((i + batchSize) % 1000 === 0) {
            logger_1.logger.info('Progress', { processed: i + batchSize, total: calls.length });
        }
    }
    logger_1.logger.info('Inserted calls', { inserted, skipped, total: calls.length });
    return inserted;
}
/**
 * Get statistics from unified database
 */
async function getStatistics(db) {
    const all = (0, util_1.promisify)(db.all.bind(db));
    const stats = await all(`
    SELECT 
      COUNT(*) as total_calls,
      COUNT(DISTINCT token_address) as unique_tokens,
      COUNT(DISTINCT caller_name) as unique_callers,
      MIN(call_timestamp) as earliest_call,
      MAX(call_timestamp) as latest_call
    FROM unified_calls
  `);
    const callerStats = await all(`
    SELECT 
      caller_name,
      COUNT(*) as call_count,
      COUNT(DISTINCT token_address) as unique_tokens
    FROM unified_calls
    GROUP BY caller_name
    ORDER BY call_count DESC
    LIMIT 20
  `);
    if (stats.length > 0) {
        const stat = stats[0];
        logger_1.logger.info('Unified database statistics', {
            totalCalls: stat.total_calls,
            uniqueTokens: stat.unique_tokens,
            uniqueCallers: stat.unique_callers,
            earliestCall: new Date(stat.earliest_call * 1000).toISOString(),
            latestCall: new Date(stat.latest_call * 1000).toISOString(),
        });
        console.log('\n📊 TOP 20 CALLERS BY CALL COUNT\n');
        for (const caller of callerStats) {
            console.log(`${caller.caller_name.padEnd(40)} ${caller.call_count.toString().padStart(6)} calls, ` +
                `${caller.unique_tokens} unique tokens`);
        }
    }
}
/**
 * Main execution
 */
async function main() {
    logger_1.logger.info('Creating unified calls table');
    try {
        // Check if source database exists
        if (!fs.existsSync(DB_PATH)) {
            logger_1.logger.error('Source database not found', { path: DB_PATH });
            process.exit(1);
        }
        // Open source database
        const sourceDb = new sqlite3_1.Database(DB_PATH, (err) => {
            if (err) {
                logger_1.logger.error('Failed to open source database', err);
                process.exit(1);
            }
        });
        // Initialize unified database
        const unifiedDb = await initUnifiedDatabase();
        // Extract calls from both tables
        logger_1.logger.info('Extracting calls from caller_alerts...');
        const callerAlerts = await extractCallerAlerts(sourceDb);
        logger_1.logger.info('Extracting calls from ca_calls...');
        const caCalls = await extractCACalls(sourceDb);
        // Combine and deduplicate
        const allCalls = [...callerAlerts, ...caCalls];
        logger_1.logger.info('Total calls extracted', {
            callerAlerts: callerAlerts.length,
            caCalls: caCalls.length,
            total: allCalls.length,
        });
        // Insert into unified database
        logger_1.logger.info('Inserting calls into unified database...');
        const inserted = await insertCalls(unifiedDb, allCalls);
        // Get statistics
        await getStatistics(unifiedDb);
        // Close databases
        sourceDb.close();
        unifiedDb.close();
        logger_1.logger.info('Unified calls table created successfully', {
            totalCalls: allCalls.length,
            inserted,
            dbPath: UNIFIED_DB_PATH,
        });
        console.log(`\n✅ Unified database created: ${UNIFIED_DB_PATH}`);
    }
    catch (error) {
        logger_1.logger.error('Failed to create unified table', error);
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
//# sourceMappingURL=create-unified-calls-table.js.map