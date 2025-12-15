/**
 * TokensRepository - Postgres repository for tokens
 *
 * Handles all database operations for tokens table.
 * CRITICAL: Always preserve full mint address and exact case.
 */

import { PoolClient } from 'pg';
import { DateTime } from 'luxon';
import { getPostgresPool, withPostgresTransaction } from '../postgres-client';
import { logger } from '@quantbot/utils';
import type { Token, Chain, TokenAddress } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';

export interface TokenMetadata {
  symbol?: string;
  name?: string;
  decimals?: number;
  [key: string]: unknown;
}

export class TokensRepository {
  /**
   * Find token by ID
   * CRITICAL: Returns full address with exact case.
   */
  async findById(id: number): Promise<Token | null> {
    const result = await getPostgresPool().query<{
      id: number;
      chain: string;
      address: string;
      symbol: string | null;
      name: string | null;
      decimals: number | null;
      metadata_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, chain, address, symbol, name, decimals, metadata_json, created_at, updated_at
       FROM tokens
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      chain: row.chain as Chain,
      address: row.address as TokenAddress, // Full address, case-preserved
      symbol: row.symbol || undefined,
      name: row.name || undefined,
      decimals: row.decimals || undefined,
      metadata: row.metadata_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    };
  }

  /**
   * Get or create a token by chain and address
   * CRITICAL: Preserves full address and exact case
   */
  async getOrCreateToken(
    chain: Chain,
    address: TokenAddress,
    metadata?: TokenMetadata
  ): Promise<Token> {
    return withPostgresTransaction(async (client: any) => {
      // Try to find existing (case-sensitive match)
      const findResult: any = await client.query(
        `SELECT id, chain, address, symbol, name, decimals, metadata_json, created_at, updated_at
         FROM tokens
         WHERE chain = $1 AND address = $2`,
        [chain, address] // Full address, case-preserved
      );

      if (findResult.rows && findResult.rows.length > 0) {
        const row = findResult.rows[0];
        return {
          id: row.id,
          chain: row.chain as Chain,
          address: row.address, // Full address
          symbol: row.symbol || undefined,
          name: row.name || undefined,
          decimals: row.decimals || undefined,
          metadata: row.metadata_json || undefined,
          createdAt: DateTime.fromJSDate(row.created_at),
          updatedAt: DateTime.fromJSDate(row.updated_at),
        };
      }

      // Create new
      const metadataJson = metadata ? JSON.stringify(metadata) : null;
      const insertResult = await client.query(
        `INSERT INTO tokens (chain, address, symbol, name, decimals, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, chain, address, symbol, name, decimals, metadata_json, created_at, updated_at`,
        [
          chain,
          address, // Full address, case-preserved
          metadata?.symbol || null,
          metadata?.name || null,
          metadata?.decimals || null,
          metadataJson,
        ]
      );

      const row = insertResult.rows[0] as any;
      logger.info('Created new token', {
        id: row.id,
        chain,
        address: address.substring(0, 20) + '...', // Display only
      });
      return {
        id: row.id,
        chain: row.chain as Chain,
        address: row.address, // Full address
        symbol: row.symbol || undefined,
        name: row.name || undefined,
        decimals: row.decimals || undefined,
        metadata: row.metadata_json || undefined,
        createdAt: DateTime.fromJSDate(row.created_at),
        updatedAt: DateTime.fromJSDate(row.updated_at),
      };
    });
  }

  /**
   * Find token by mint address and chain
   * CRITICAL: Uses exact case-sensitive match
   */
  async findByMint(chain: Chain, address: TokenAddress): Promise<Token | null> {
    const result = await getPostgresPool().query<{
      id: number;
      chain: string;
      address: string;
      symbol: string | null;
      name: string | null;
      decimals: number | null;
      metadata_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, chain, address, symbol, name, decimals, metadata_json, created_at, updated_at
       FROM tokens
       WHERE chain = $1 AND address = $2`,
      [chain, address] // Full address, case-preserved
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      chain: row.chain as Chain,
      address: createTokenAddress(row.address), // Full address
      symbol: row.symbol || undefined,
      name: row.name || undefined,
      decimals: row.decimals || undefined,
      metadata: row.metadata_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    };
  }

  /**
   * Update token metadata
   */
  async updateMetadata(
    chain: Chain,
    address: TokenAddress,
    metadata: TokenMetadata
  ): Promise<void> {
    await withPostgresTransaction(async (client) => {
      const metadataJson = JSON.stringify(metadata);
      await client.query(
        `UPDATE tokens
         SET symbol = COALESCE($3, symbol),
             name = COALESCE($4, name),
             decimals = COALESCE($5, decimals),
             metadata_json = COALESCE($6, metadata_json),
             updated_at = NOW()
         WHERE chain = $1 AND address = $2`,
        [
          chain,
          address, // Full address, case-preserved
          metadata.symbol || null,
          metadata.name || null,
          metadata.decimals || null,
          metadataJson,
        ]
      );
    });
  }
}
