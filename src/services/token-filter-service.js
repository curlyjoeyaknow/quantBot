"use strict";
/**
 * Token Filtering & Query Service
 *
 * Filters tokens from ClickHouse and SQLite based on user criteria.
 * Supports complex filtering by chain, date range, volume, price, caller, etc.
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
exports.tokenFilterService = exports.TokenFilterService = void 0;
const luxon_1 = require("luxon");
const clickhouse_client_1 = require("../storage/clickhouse-client");
const token_service_1 = require("./token-service");
const logger_1 = require("../utils/logger");
const sqlite3 = __importStar(require("sqlite3"));
const path = __importStar(require("path"));
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * Token Filter Service for querying tokens with complex criteria
 */
class TokenFilterService {
    /**
     * Filter tokens based on criteria
     */
    async filterTokens(criteria) {
        try {
            // Start with tokens from SQLite registry
            const sqliteFilters = {};
            if (criteria.chain) {
                sqliteFilters.chain = criteria.chain;
            }
            let tokens = await token_service_1.tokenService.listTokens(sqliteFilters);
            // If no tokens in registry but we have criteria, we might need to query ClickHouse directly
            if (tokens.length === 0 && criteria.hasCandleData) {
                tokens = await this.getTokensFromClickHouse(criteria);
            }
            // Apply filters
            const filtered = [];
            for (const token of tokens) {
                const filteredToken = { ...token };
                // Check if token has candle data in ClickHouse
                if (criteria.hasCandleData !== undefined) {
                    const hasData = await this.checkTokenHasCandleData(token.mint, token.chain, criteria.dateRange);
                    if (criteria.hasCandleData && !hasData) {
                        continue;
                    }
                    if (!criteria.hasCandleData && hasData) {
                        continue;
                    }
                    filteredToken.hasCandleData = hasData;
                }
                // Get additional data from ClickHouse if needed
                if (criteria.volumeRange || criteria.priceRange) {
                    const stats = await this.getTokenStats(token.mint, token.chain, criteria.dateRange);
                    filteredToken.avgVolume = stats.avgVolume;
                    filteredToken.avgPrice = stats.avgPrice;
                    filteredToken.lastCandleTime = stats.lastCandleTime;
                    // Apply volume filter
                    if (criteria.volumeRange) {
                        const { min, max } = criteria.volumeRange;
                        if (min !== undefined && (stats.avgVolume || 0) < min) {
                            continue;
                        }
                        if (max !== undefined && (stats.avgVolume || 0) > max) {
                            continue;
                        }
                    }
                    // Apply price filter
                    if (criteria.priceRange) {
                        const { min, max } = criteria.priceRange;
                        if (min !== undefined && (stats.avgPrice || 0) < min) {
                            continue;
                        }
                        if (max !== undefined && (stats.avgPrice || 0) > max) {
                            continue;
                        }
                    }
                }
                // Filter by caller (from ca_calls table)
                if (criteria.caller) {
                    const hasCaller = await this.checkTokenHasCaller(token.mint, token.chain, criteria.caller, criteria.dateRange);
                    if (!hasCaller) {
                        continue;
                    }
                }
                filtered.push(filteredToken);
            }
            // Apply limit and offset
            const offset = criteria.offset || 0;
            const limit = criteria.limit || filtered.length;
            return filtered.slice(offset, offset + limit);
        }
        catch (error) {
            logger_1.logger.error('Failed to filter tokens', error, { criteria });
            throw error;
        }
    }
    /**
     * Get tokens directly from ClickHouse (for tokens not in SQLite registry)
     */
    async getTokensFromClickHouse(criteria) {
        try {
            const ch = (0, clickhouse_client_1.getClickHouseClient)();
            const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';
            let query = `
        SELECT DISTINCT token_address as mint, chain
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE 1=1
      `;
            if (criteria.chain) {
                query += ` AND chain = '${criteria.chain.replace(/'/g, "''")}'`;
            }
            if (criteria.dateRange) {
                const startUnix = Math.floor(criteria.dateRange.start.toSeconds());
                const endUnix = Math.floor(criteria.dateRange.end.toSeconds());
                query += ` AND timestamp >= toDateTime(${startUnix}) AND timestamp <= toDateTime(${endUnix})`;
            }
            query += ` ORDER BY mint LIMIT ${criteria.limit || 1000}`;
            const result = await ch.query({
                query,
                format: 'JSONEachRow',
            });
            const data = (await result.json());
            return data.map((row) => ({
                mint: row.mint,
                chain: row.chain,
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get tokens from ClickHouse', error);
            return [];
        }
    }
    /**
     * Check if token has candle data in ClickHouse
     */
    async checkTokenHasCandleData(mint, chain, dateRange) {
        try {
            const ch = (0, clickhouse_client_1.getClickHouseClient)();
            const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';
            let query = `
        SELECT count() as count
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE token_address = '${mint.replace(/'/g, "''")}' AND chain = '${chain.replace(/'/g, "''")}'
      `;
            if (dateRange) {
                const startUnix = Math.floor(dateRange.start.toSeconds());
                const endUnix = Math.floor(dateRange.end.toSeconds());
                query += ` AND timestamp >= toDateTime(${startUnix}) AND timestamp <= toDateTime(${endUnix})`;
            }
            const result = await ch.query({
                query,
                format: 'JSONEachRow',
            });
            const data = (await result.json());
            return (data[0]?.count || 0) > 0;
        }
        catch (error) {
            logger_1.logger.warn('Failed to check candle data', { error: error.message, mint: mint.substring(0, 20) });
            return false;
        }
    }
    /**
     * Get token statistics from ClickHouse
     */
    async getTokenStats(mint, chain, dateRange) {
        try {
            const ch = (0, clickhouse_client_1.getClickHouseClient)();
            const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';
            let query = `
        SELECT 
          avg(volume) as avg_volume,
          avg(close) as avg_price,
          max(timestamp) as last_candle_time
        FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
        WHERE token_address = '${mint.replace(/'/g, "''")}' AND chain = '${chain.replace(/'/g, "''")}'
      `;
            if (dateRange) {
                const startUnix = Math.floor(dateRange.start.toSeconds());
                const endUnix = Math.floor(dateRange.end.toSeconds());
                query += ` AND timestamp >= toDateTime(${startUnix}) AND timestamp <= toDateTime(${endUnix})`;
            }
            const result = await ch.query({
                query,
                format: 'JSONEachRow',
            });
            const data = (await result.json());
            if (data.length === 0 || !data[0]) {
                return { avgVolume: 0, avgPrice: 0 };
            }
            const row = data[0];
            return {
                avgVolume: row.avg_volume || 0,
                avgPrice: row.avg_price || 0,
                lastCandleTime: row.last_candle_time
                    ? luxon_1.DateTime.fromISO(row.last_candle_time)
                    : undefined,
            };
        }
        catch (error) {
            logger_1.logger.warn('Failed to get token stats', { error: error.message, mint: mint.substring(0, 20) });
            return { avgVolume: 0, avgPrice: 0 };
        }
    }
    /**
     * Check if token has calls from a specific caller
     */
    async checkTokenHasCaller(mint, chain, caller, dateRange) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    logger_1.logger.error('Error opening database', err);
                    return reject(err);
                }
                let query = `
          SELECT COUNT(*) as count
          FROM ca_calls
          WHERE mint = ? AND chain = ? AND caller = ?
        `;
                const params = [mint, chain, caller];
                if (dateRange) {
                    const startUnix = Math.floor(dateRange.start.toSeconds());
                    const endUnix = Math.floor(dateRange.end.toSeconds());
                    query += ' AND call_timestamp >= ? AND call_timestamp <= ?';
                    params.push(startUnix, endUnix);
                }
                db.get(query, params, (err, row) => {
                    db.close();
                    if (err) {
                        logger_1.logger.error('Error checking caller', err);
                        return reject(err);
                    }
                    resolve((row?.count || 0) > 0);
                });
            });
        });
    }
    /**
     * Get token count matching criteria
     */
    async getTokenCount(criteria) {
        const tokens = await this.filterTokens({ ...criteria, limit: undefined });
        return tokens.length;
    }
}
exports.TokenFilterService = TokenFilterService;
// Export singleton instance
exports.tokenFilterService = new TokenFilterService();
//# sourceMappingURL=token-filter-service.js.map