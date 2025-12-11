/**
 * CallersRepository - Postgres repository for callers (signal sources)
 * 
 * Handles all database operations for callers table.
 * No business logic - just SQL operations.
 */

import { PoolClient, QueryResult } from 'pg';
import { DateTime } from 'luxon';
import { getPostgresPool, withPostgresTransaction } from '../../postgres-client';
import { logger } from '@quantbot/utils';
import type { Caller } from '@quantbot/core';

export class CallersRepository {
  /**
   * Get or create a caller by source and handle
   */
  async getOrCreateCaller(source: string, handle: string, displayName?: string, attributes?: Record<string, unknown>): Promise<Caller> {
    return withPostgresTransaction(async (client) => {
      // Try to find existing
      const findResult = await client.query<{
        id: number;
        source: string;
        handle: string;
        display_name: string | null;
        attributes_json: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
         FROM callers
         WHERE source = $1 AND handle = $2`,
        [source, handle]
      );

      if (findResult.rows.length > 0) {
        const row = findResult.rows[0];
        return {
          id: row.id,
          source: row.source,
          handle: row.handle,
          displayName: row.display_name || undefined,
          attributes: row.attributes_json || undefined,
          createdAt: DateTime.fromJSDate(row.created_at),
          updatedAt: DateTime.fromJSDate(row.updated_at),
        };
      }

      // Create new
      const insertResult = await client.query<{
        id: number;
        source: string;
        handle: string;
        display_name: string | null;
        attributes_json: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO callers (source, handle, display_name, attributes_json)
         VALUES ($1, $2, $3, $4)
         RETURNING id, source, handle, display_name, attributes_json, created_at, updated_at`,
        [source, handle, displayName || null, attributes ? JSON.stringify(attributes) : null]
      );

      const row = insertResult.rows[0];
      logger.info('Created new caller', { id: row.id, source, handle });
      return {
        id: row.id,
        source: row.source,
        handle: row.handle,
        displayName: row.display_name || undefined,
        attributes: row.attributes_json || undefined,
        createdAt: DateTime.fromJSDate(row.created_at),
        updatedAt: DateTime.fromJSDate(row.updated_at),
      };
    });
  }

  /**
   * Find caller by name (source + handle combination)
   */
  async findByName(source: string, handle: string): Promise<Caller | null> {
    const result = await getPostgresPool().query<{
      id: number;
      source: string;
      handle: string;
      display_name: string | null;
      attributes_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
       FROM callers
       WHERE source = $1 AND handle = $2`,
      [source, handle]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      source: row.source,
      handle: row.handle,
      displayName: row.display_name || undefined,
      attributes: row.attributes_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    };
  }

  /**
   * Find caller by ID
   */
  async findById(id: number): Promise<Caller | null> {
    const result = await getPostgresPool().query<{
      id: number;
      source: string;
      handle: string;
      display_name: string | null;
      attributes_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
       FROM callers
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      source: row.source,
      handle: row.handle,
      displayName: row.display_name || undefined,
      attributes: row.attributes_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    };
  }

  /**
   * List all callers
   */
  async list(): Promise<Caller[]> {
    const result = await getPostgresPool().query<{
      id: number;
      source: string;
      handle: string;
      display_name: string | null;
      attributes_json: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, source, handle, display_name, attributes_json, created_at, updated_at
       FROM callers
       ORDER BY created_at DESC`
    );

    return result.rows.map((row) => ({
      id: row.id,
      source: row.source,
      handle: row.handle,
      displayName: row.display_name || undefined,
      attributes: row.attributes_json || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    }));
  }
}

