"use strict";
/**
 * Token Management Service
 *
 * Manages token registry in SQLite with user-requested token addition.
 * Provides CRUD operations and metadata caching.
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
exports.tokenService = exports.TokenService = void 0;
const sqlite3 = __importStar(require("sqlite3"));
const util_1 = require("util");
const path = __importStar(require("path"));
const birdeye_client_1 = require("../api/birdeye-client");
const logger_1 = require("../utils/logger");
const DB_PATH = path.join(process.cwd(), 'simulations.db');
/**
 * Token Service for managing token registry
 */
class TokenService {
    constructor() {
        this.db = null;
    }
    /**
     * Get or create database connection
     */
    async getDatabase() {
        if (this.db) {
            return this.db;
        }
        return new Promise((resolve, reject) => {
            this.db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    logger_1.logger.error('Error opening database for TokenService', err);
                    return reject(err);
                }
                resolve(this.db);
            });
        });
    }
    /**
     * Ensure tokens table exists
     */
    async ensureTable() {
        const db = await this.getDatabase();
        const run = (0, util_1.promisify)(db.run.bind(db));
        await run(`
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
      )
    `);
        await run(`
      CREATE INDEX IF NOT EXISTS idx_tokens_mint_chain ON tokens(mint, chain)
    `);
    }
    /**
     * Add a token to the registry (auto-adds if requested by user)
     */
    async addToken(mint, chain = 'solana', userId, metadata) {
        await this.ensureTable();
        const db = await this.getDatabase();
        const run = (0, util_1.promisify)(db.run.bind(db));
        const get = (0, util_1.promisify)(db.get.bind(db));
        // Check if token already exists
        const existing = await get('SELECT * FROM tokens WHERE mint = ? AND chain = ?', [
            mint,
            chain,
        ]);
        if (existing) {
            logger_1.logger.debug('Token already exists in registry', { mint: mint.substring(0, 20), chain });
            return {
                mint: existing.mint,
                chain: existing.chain,
                tokenName: existing.token_name,
                tokenSymbol: existing.token_symbol,
                addedByUserId: existing.added_by_user_id,
            };
        }
        // Fetch metadata from Birdeye if not provided
        let tokenName = metadata?.tokenName;
        let tokenSymbol = metadata?.tokenSymbol;
        if (!tokenName || !tokenSymbol) {
            try {
                const birdeyeMetadata = await birdeye_client_1.birdeyeClient.getTokenMetadata(mint, chain);
                if (birdeyeMetadata) {
                    tokenName = tokenName || birdeyeMetadata.name;
                    tokenSymbol = tokenSymbol || birdeyeMetadata.symbol;
                }
            }
            catch (error) {
                logger_1.logger.warn('Failed to fetch token metadata from Birdeye', {
                    error: error.message,
                    mint: mint.substring(0, 20),
                });
            }
        }
        // Insert token
        await run(`INSERT INTO tokens (mint, chain, token_name, token_symbol, added_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`, [mint, chain, tokenName || null, tokenSymbol || null, userId || null]);
        logger_1.logger.info('Added token to registry', {
            mint: mint.substring(0, 20),
            chain,
            userId,
        });
        return {
            mint,
            chain,
            tokenName: tokenName || undefined,
            tokenSymbol: tokenSymbol || undefined,
            addedByUserId: userId,
        };
    }
    /**
     * Get token information
     */
    async getToken(mint, chain = 'solana') {
        await this.ensureTable();
        const db = await this.getDatabase();
        const get = (0, util_1.promisify)(db.get.bind(db));
        const token = await get('SELECT * FROM tokens WHERE mint = ? AND chain = ?', [
            mint,
            chain,
        ]);
        if (!token) {
            return null;
        }
        return {
            mint: token.mint,
            chain: token.chain,
            tokenName: token.token_name,
            tokenSymbol: token.token_symbol,
            addedByUserId: token.added_by_user_id,
        };
    }
    /**
     * List tokens with optional filters
     */
    async listTokens(filters = {}) {
        await this.ensureTable();
        const db = await this.getDatabase();
        const all = (0, util_1.promisify)(db.all.bind(db));
        let query = 'SELECT * FROM tokens WHERE 1=1';
        const params = [];
        if (filters.chain) {
            query += ' AND chain = ?';
            params.push(filters.chain);
        }
        if (filters.addedByUserId !== undefined) {
            query += ' AND added_by_user_id = ?';
            params.push(filters.addedByUserId);
        }
        if (filters.createdAfter) {
            query += ' AND created_at >= ?';
            params.push(filters.createdAfter.toISOString());
        }
        if (filters.createdBefore) {
            query += ' AND created_at <= ?';
            params.push(filters.createdBefore.toISOString());
        }
        if (filters.search) {
            query +=
                ' AND (mint LIKE ? OR token_name LIKE ? OR token_symbol LIKE ?)';
            const searchPattern = `%${filters.search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }
        query += ' ORDER BY created_at DESC';
        const tokens = await all(query, params);
        return tokens.map((token) => ({
            mint: token.mint,
            chain: token.chain,
            tokenName: token.token_name,
            tokenSymbol: token.token_symbol,
            addedByUserId: token.added_by_user_id,
        }));
    }
    /**
     * Update token metadata
     */
    async updateTokenMetadata(mint, chain, metadata) {
        await this.ensureTable();
        const db = await this.getDatabase();
        const run = (0, util_1.promisify)(db.run.bind(db));
        const get = (0, util_1.promisify)(db.get.bind(db));
        // Check if token exists
        const existing = await this.getToken(mint, chain);
        if (!existing) {
            return null;
        }
        // Update metadata
        const updates = [];
        const params = [];
        if (metadata.tokenName !== undefined) {
            updates.push('token_name = ?');
            params.push(metadata.tokenName);
        }
        if (metadata.tokenSymbol !== undefined) {
            updates.push('token_symbol = ?');
            params.push(metadata.tokenSymbol);
        }
        if (updates.length === 0) {
            return existing;
        }
        updates.push('updated_at = CURRENT_TIMESTAMP');
        params.push(mint, chain);
        await run(`UPDATE tokens SET ${updates.join(', ')} WHERE mint = ? AND chain = ?`, params);
        logger_1.logger.debug('Updated token metadata', { mint: mint.substring(0, 20), chain });
        return this.getToken(mint, chain);
    }
    /**
     * Delete a token from the registry
     */
    async deleteToken(mint, chain = 'solana') {
        await this.ensureTable();
        const db = await this.getDatabase();
        const run = (0, util_1.promisify)(db.run.bind(db));
        const result = await run('DELETE FROM tokens WHERE mint = ? AND chain = ?', [
            mint,
            chain,
        ]);
        const deleted = result.changes > 0;
        if (deleted) {
            logger_1.logger.info('Deleted token from registry', { mint: mint.substring(0, 20), chain });
        }
        return deleted;
    }
    /**
     * Get token count
     */
    async getTokenCount(filters = {}) {
        await this.ensureTable();
        const db = await this.getDatabase();
        const get = (0, util_1.promisify)(db.get.bind(db));
        let query = 'SELECT COUNT(*) as count FROM tokens WHERE 1=1';
        const params = [];
        if (filters.chain) {
            query += ' AND chain = ?';
            params.push(filters.chain);
        }
        if (filters.addedByUserId !== undefined) {
            query += ' AND added_by_user_id = ?';
            params.push(filters.addedByUserId);
        }
        if (filters.createdAfter) {
            query += ' AND created_at >= ?';
            params.push(filters.createdAfter.toISOString());
        }
        if (filters.createdBefore) {
            query += ' AND created_at <= ?';
            params.push(filters.createdBefore.toISOString());
        }
        if (filters.search) {
            query +=
                ' AND (mint LIKE ? OR token_name LIKE ? OR token_symbol LIKE ?)';
            const searchPattern = `%${filters.search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }
        const result = await get(query, params);
        return result?.count || 0;
    }
    /**
     * Close database connection
     */
    async close() {
        if (this.db) {
            return new Promise((resolve, reject) => {
                this.db.close((err) => {
                    if (err) {
                        logger_1.logger.error('Error closing database', err);
                        return reject(err);
                    }
                    this.db = null;
                    resolve();
                });
            });
        }
    }
}
exports.TokenService = TokenService;
// Export singleton instance
exports.tokenService = new TokenService();
//# sourceMappingURL=token-service.js.map