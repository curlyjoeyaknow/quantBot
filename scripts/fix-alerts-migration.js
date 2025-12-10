#!/usr/bin/env tsx
"use strict";
/**
 * Fix alerts migration - use correct timestamps and case-sensitive addresses
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const sqlite_1 = require("sqlite");
const sqlite3_1 = __importDefault(require("sqlite3"));
const pg_1 = require("pg");
const logger_1 = require("../packages/utils/src/logger");
const SQLITE_PATH = '/home/memez/quantBot/data/caller_alerts.db';
const pgPool = new pg_1.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'quantbot',
    password: process.env.POSTGRES_PASSWORD || 'quantbot',
    database: process.env.POSTGRES_DB || 'quantbot',
});
async function fixAlertsTimestamps() {
    logger_1.logger.info('🔄 Fixing alert timestamps and addresses from SQLite...');
    const sqlite = await (0, sqlite_1.open)({
        filename: SQLITE_PATH,
        driver: sqlite3_1.default.Database,
    });
    const pgClient = await pgPool.connect();
    try {
        // Get all alerts from SQLite with their correct data
        const alerts = await sqlite.all(`SELECT 
        id, 
        caller_name, 
        token_address, 
        token_symbol,
        alert_timestamp, 
        price_at_alert,
        alert_message,
        volume_at_alert,
        chain
      FROM caller_alerts 
      WHERE alert_timestamp > '2025-01-01'
      ORDER BY alert_timestamp ASC`);
        logger_1.logger.info(`Found ${alerts.length} alerts with valid 2025 timestamps in SQLite`);
        let updated = 0;
        let inserted = 0;
        let skipped = 0;
        await pgClient.query('BEGIN');
        for (const alert of alerts) {
            try {
                // Preserve original case for address matching
                const tokenAddress = alert.token_address;
                // Get token_id - try case-insensitive match first
                const tokenResult = await pgClient.query('SELECT id FROM tokens WHERE chain = $1 AND LOWER(address) = LOWER($2)', [alert.chain || 'solana', tokenAddress]);
                if (tokenResult.rows.length === 0) {
                    logger_1.logger.warn(`Token not found: ${tokenAddress}`);
                    skipped++;
                    continue;
                }
                const tokenId = tokenResult.rows[0].id;
                // Get caller_id
                const callerResult = await pgClient.query('SELECT id FROM callers WHERE source = $1 AND handle = $2', ['legacy', alert.caller_name]);
                if (callerResult.rows.length === 0) {
                    logger_1.logger.warn(`Caller not found: ${alert.caller_name}`);
                    skipped++;
                    continue;
                }
                const callerId = callerResult.rows[0].id;
                // Try to update existing alert or insert new one
                const existingAlert = await pgClient.query(`SELECT id FROM alerts 
           WHERE token_id = $1 AND caller_id = $2 
           AND ABS(EXTRACT(EPOCH FROM (alert_timestamp - $3::timestamptz))) < 60`, [tokenId, callerId, alert.alert_timestamp]);
                if (existingAlert.rows.length > 0) {
                    // Update existing alert with correct timestamp and price
                    await pgClient.query(`UPDATE alerts 
             SET alert_timestamp = $1, 
                 alert_price = $2,
                 raw_payload_json = $3
             WHERE id = $4`, [
                        alert.alert_timestamp,
                        alert.price_at_alert,
                        JSON.stringify({
                            message: alert.alert_message,
                            volume: alert.volume_at_alert,
                            legacy_id: alert.id,
                        }),
                        existingAlert.rows[0].id,
                    ]);
                    updated++;
                }
                else {
                    // Insert new alert
                    await pgClient.query(`INSERT INTO alerts (
              token_id, caller_id, side, alert_price, alert_timestamp,
              raw_payload_json
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING`, [
                        tokenId,
                        callerId,
                        'buy',
                        alert.price_at_alert,
                        alert.alert_timestamp,
                        JSON.stringify({
                            message: alert.alert_message,
                            volume: alert.volume_at_alert,
                            legacy_id: alert.id,
                        }),
                    ]);
                    inserted++;
                }
                if ((updated + inserted) % 100 === 0) {
                    logger_1.logger.info(`Progress: ${updated} updated, ${inserted} inserted, ${skipped} skipped`);
                }
            }
            catch (error) {
                logger_1.logger.error(`Failed to process alert ${alert.id}:`, error);
                skipped++;
            }
        }
        await pgClient.query('COMMIT');
        logger_1.logger.info('✅ Alert migration complete');
        logger_1.logger.info(`   Updated: ${updated}`);
        logger_1.logger.info(`   Inserted: ${inserted}`);
        logger_1.logger.info(`   Skipped: ${skipped}`);
    }
    catch (error) {
        await pgClient.query('ROLLBACK');
        logger_1.logger.error('Migration failed:', error);
        throw error;
    }
    finally {
        pgClient.release();
        await sqlite.close();
        await pgPool.end();
    }
}
fixAlertsTimestamps().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=fix-alerts-migration.js.map