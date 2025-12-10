"use strict";
/**
 * Monitored Tokens Database Utilities
 * ====================================
 * Functions for storing and retrieving monitored tokens from Postgres
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.storeMonitoredToken = storeMonitoredToken;
exports.getActiveMonitoredTokens = getActiveMonitoredTokens;
exports.updateMonitoredTokenStatus = updateMonitoredTokenStatus;
exports.updateMonitoredTokenEntry = updateMonitoredTokenEntry;
const postgres_client_1 = require("../storage/postgres-client");
const logger_1 = require("./logger");
/**
 * Store a monitored token in Postgres
 */
async function storeMonitoredToken(token) {
    try {
        const result = await (0, postgres_client_1.withPostgresTransaction)(async (client) => {
            // First, ensure token exists in tokens table
            let tokenId = null;
            const tokenResult = await client.query(`INSERT INTO tokens (chain, address, symbol, name, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (chain, address) 
         DO UPDATE SET symbol = COALESCE(EXCLUDED.symbol, tokens.symbol),
                       name = COALESCE(EXCLUDED.name, tokens.name),
                       updated_at = NOW()
         RETURNING id`, [token.chain, token.tokenAddress, token.tokenSymbol || null, token.tokenSymbol || null]);
            if (tokenResult.rows.length > 0) {
                tokenId = tokenResult.rows[0].id;
            }
            // Ensure caller exists
            let callerId = null;
            const callerResult = await client.query(`INSERT INTO callers (source, handle, display_name, updated_at)
         VALUES ('telegram', $1, $1, NOW())
         ON CONFLICT (source, handle) 
         DO UPDATE SET updated_at = NOW()
         RETURNING id`, [token.callerName]);
            if (callerResult.rows.length > 0) {
                callerId = callerResult.rows[0].id;
            }
            // Insert or update monitored token
            const insertResult = await client.query(`INSERT INTO monitored_tokens (
          token_id, token_address, chain, token_symbol, caller_id, caller_name,
          alert_timestamp, alert_price, entry_config_json, status,
          historical_candles_count, last_price, last_update_time,
          entry_signal_sent, entry_price, entry_time, entry_type
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (token_address, chain, caller_name, alert_timestamp)
        DO UPDATE SET
          status = EXCLUDED.status,
          entry_config_json = EXCLUDED.entry_config_json,
          historical_candles_count = EXCLUDED.historical_candles_count,
          last_price = EXCLUDED.last_price,
          last_update_time = EXCLUDED.last_update_time,
          entry_signal_sent = EXCLUDED.entry_signal_sent,
          entry_price = EXCLUDED.entry_price,
          entry_time = EXCLUDED.entry_time,
          entry_type = EXCLUDED.entry_type,
          updated_at = NOW()
        RETURNING id`, [
                tokenId,
                token.tokenAddress,
                token.chain,
                token.tokenSymbol || null,
                callerId,
                token.callerName,
                token.alertTimestamp,
                token.alertPrice,
                token.entryConfig ? JSON.stringify(token.entryConfig) : null,
                token.status || 'active',
                token.historicalCandlesCount || 0,
                token.lastPrice || null,
                token.lastUpdateTime || null,
                token.entrySignalSent || false,
                token.entryPrice || null,
                token.entryTime || null,
                token.entryType || null,
            ]);
            return insertResult.rows[0].id;
        });
        logger_1.logger.info('Stored monitored token in Postgres', {
            tokenAddress: token.tokenAddress.substring(0, 20),
            callerName: token.callerName,
            id: result,
        });
        return result;
    }
    catch (error) {
        logger_1.logger.error('Failed to store monitored token', error, {
            tokenAddress: token.tokenAddress.substring(0, 20),
        });
        throw error;
    }
}
/**
 * Get all active monitored tokens
 */
async function getActiveMonitoredTokens() {
    try {
        const result = await (0, postgres_client_1.queryPostgres)(`SELECT 
        id, token_address, chain, token_symbol, caller_name,
        alert_timestamp, alert_price, entry_config_json, status,
        historical_candles_count, last_price, last_update_time,
        entry_signal_sent, entry_price, entry_time, entry_type
       FROM monitored_tokens
       WHERE status = 'active'
       ORDER BY created_at DESC`);
        return result.rows.map(row => ({
            id: row.id,
            tokenAddress: row.token_address,
            chain: row.chain,
            tokenSymbol: row.token_symbol || undefined,
            callerName: row.caller_name,
            alertTimestamp: row.alert_timestamp,
            alertPrice: parseFloat(row.alert_price),
            entryConfig: row.entry_config_json ? JSON.parse(row.entry_config_json) : undefined,
            status: row.status,
            historicalCandlesCount: row.historical_candles_count,
            lastPrice: row.last_price ? parseFloat(row.last_price) : undefined,
            lastUpdateTime: row.last_update_time || undefined,
            entrySignalSent: row.entry_signal_sent,
            entryPrice: row.entry_price ? parseFloat(row.entry_price) : undefined,
            entryTime: row.entry_time || undefined,
            entryType: row.entry_type,
        }));
    }
    catch (error) {
        logger_1.logger.error('Failed to get active monitored tokens', error);
        return [];
    }
}
/**
 * Update monitored token status
 */
async function updateMonitoredTokenStatus(id, status) {
    try {
        await (0, postgres_client_1.queryPostgres)(`UPDATE monitored_tokens 
       SET status = $1, updated_at = NOW()
       WHERE id = $2`, [status, id]);
        logger_1.logger.info('Updated monitored token status', { id, status });
    }
    catch (error) {
        logger_1.logger.error('Failed to update monitored token status', error, { id });
        throw error;
    }
}
/**
 * Update monitored token entry information
 */
async function updateMonitoredTokenEntry(id, entryPrice, entryTime, entryType, signalSent = true) {
    try {
        await (0, postgres_client_1.queryPostgres)(`UPDATE monitored_tokens 
       SET entry_price = $1, entry_time = $2, entry_type = $3,
           entry_signal_sent = $4, updated_at = NOW()
       WHERE id = $5`, [entryPrice, entryTime, entryType, signalSent, id]);
        logger_1.logger.info('Updated monitored token entry', { id, entryPrice, entryType });
    }
    catch (error) {
        logger_1.logger.error('Failed to update monitored token entry', error, { id });
        throw error;
    }
}
//# sourceMappingURL=monitored-tokens-db.js.map