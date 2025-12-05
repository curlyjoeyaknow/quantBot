/**
 * Token Management Service
 * 
 * Manages token registry in SQLite with user-requested token addition.
 * Provides CRUD operations and metadata caching.
 */

import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { logger } from '@quantbot/utils';

// TODO: birdeyeClient should be injected as a dependency or moved to this package
// import { birdeyeClient } from '@quantbot/external-apis';

export interface TokenMetadata {
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  addedByUserId?: number;
}

export interface TokenFilters {
  chain?: string;
  addedByUserId?: number;
  createdAfter?: Date;
  createdBefore?: Date;
  search?: string; // Search in mint, name, or symbol
}

const DB_PATH = path.join(process.cwd(), 'simulations.db');

/**
 * Token Service for managing token registry
 */
export class TokenService {
  private db: sqlite3.Database | null = null;

  /**
   * Get or create database connection
   */
  private async getDatabase(): Promise<sqlite3.Database> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
          logger.error('Error opening database for TokenService', err as Error);
          return reject(err);
        }
        resolve(this.db!);
      });
    });
  }

  /**
   * Ensure tokens table exists
   */
  private async ensureTable(): Promise<void> {
    const db = await this.getDatabase();
    const run = promisify(db.run.bind(db));

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
  async addToken(
    mint: string,
    chain: string = 'solana',
    userId?: number,
    metadata?: Partial<Pick<TokenMetadata, 'tokenName' | 'tokenSymbol'>>
  ): Promise<TokenMetadata> {
    await this.ensureTable();
    const db = await this.getDatabase();
    const run = promisify(db.run.bind(db));
    const get = promisify(db.get.bind(db)) as (
      sql: string,
      params: any[]
    ) => Promise<any>;

    // Check if token already exists
    const existing = await get('SELECT * FROM tokens WHERE mint = ? AND chain = ?', [
      mint,
      chain,
    ]);

    if (existing) {
      logger.debug('Token already exists in registry', { mint: mint.substring(0, 20), chain });
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
        const birdeyeMetadata = await birdeyeClient.getTokenMetadata(mint, chain);
        if (birdeyeMetadata) {
          tokenName = tokenName || birdeyeMetadata.name;
          tokenSymbol = tokenSymbol || birdeyeMetadata.symbol;
        }
      } catch (error: any) {
        logger.warn('Failed to fetch token metadata from Birdeye', {
          error: error.message,
          mint: mint.substring(0, 20),
        });
      }
    }

    // Insert token
    await run(
      `INSERT INTO tokens (mint, chain, token_name, token_symbol, added_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [mint, chain, tokenName || null, tokenSymbol || null, userId || null]
    );

    logger.info('Added token to registry', {
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
  async getToken(mint: string, chain: string = 'solana'): Promise<TokenMetadata | null> {
    await this.ensureTable();
    const db = await this.getDatabase();
    const get = promisify(db.get.bind(db)) as (
      sql: string,
      params: any[]
    ) => Promise<any>;

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
  async listTokens(filters: TokenFilters = {}): Promise<TokenMetadata[]> {
    await this.ensureTable();
    const db = await this.getDatabase();
    const all = promisify(db.all.bind(db)) as (
      sql: string,
      params: any[]
    ) => Promise<any[]>;

    let query = 'SELECT * FROM tokens WHERE 1=1';
    const params: any[] = [];

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
  async updateTokenMetadata(
    mint: string,
    chain: string,
    metadata: Partial<Pick<TokenMetadata, 'tokenName' | 'tokenSymbol'>>
  ): Promise<TokenMetadata | null> {
    await this.ensureTable();
    const db = await this.getDatabase();
    const run = promisify(db.run.bind(db));
    const get = promisify(db.get.bind(db)) as (
      sql: string,
      params: any[]
    ) => Promise<any>;

    // Check if token exists
    const existing = await this.getToken(mint, chain);
    if (!existing) {
      return null;
    }

    // Update metadata
    const updates: string[] = [];
    const params: any[] = [];

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

    await run(
      `UPDATE tokens SET ${updates.join(', ')} WHERE mint = ? AND chain = ?`,
      params
    );

    logger.debug('Updated token metadata', { mint: mint.substring(0, 20), chain });

    return this.getToken(mint, chain);
  }

  /**
   * Delete a token from the registry
   */
  async deleteToken(mint: string, chain: string = 'solana'): Promise<boolean> {
    await this.ensureTable();
    const db = await this.getDatabase();
    const run = promisify(db.run.bind(db));

    const result = await run('DELETE FROM tokens WHERE mint = ? AND chain = ?', [
      mint,
      chain,
    ]);

    const deleted = (result as any).changes > 0;

    if (deleted) {
      logger.info('Deleted token from registry', { mint: mint.substring(0, 20), chain });
    }

    return deleted;
  }

  /**
   * Get token count
   */
  async getTokenCount(filters: TokenFilters = {}): Promise<number> {
    await this.ensureTable();
    const db = await this.getDatabase();
    const get = promisify(db.get.bind(db)) as (
      sql: string,
      params: any[]
    ) => Promise<any>;

    let query = 'SELECT COUNT(*) as count FROM tokens WHERE 1=1';
    const params: any[] = [];

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
  async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db!.close((err) => {
          if (err) {
            logger.error('Error closing database', err as Error);
            return reject(err);
          }
          this.db = null;
          resolve();
        });
      });
    }
  }
}

// Export singleton instance
export const tokenService = new TokenService();

