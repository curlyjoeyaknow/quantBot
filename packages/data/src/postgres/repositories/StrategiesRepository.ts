/**
 * StrategiesRepository - Postgres repository for strategies
 * 
 * Handles all database operations for strategies table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool } from '../../postgres-client';
import { logger } from '@quantbot/utils';
import type { StrategyConfig } from '@quantbot/core';

export interface StrategyInsertData {
  name: string;
  version?: string;
  category?: string;
  description?: string;
  config: Record<string, unknown>;
  isActive?: boolean;
}

export class StrategiesRepository {
  /**
   * Find all active strategies
   */
  async findAllActive(): Promise<StrategyConfig[]> {
    const result = await getPostgresPool().query<{
      id: number;
      name: string;
      version: string;
      category: string | null;
      description: string | null;
      config_json: Record<string, unknown>;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, version, category, description, config_json, is_active, created_at, updated_at
       FROM strategies
       WHERE is_active = true
       ORDER BY name, version`
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      version: row.version,
      category: row.category || undefined,
      description: row.description || undefined,
      config: row.config_json,
      isActive: row.is_active,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    }));
  }

  /**
   * Find strategy by name (and optionally version)
   */
  async findByName(name: string, version?: string): Promise<StrategyConfig | null> {
    const versionToUse = version || '1';
    const result = await getPostgresPool().query<{
      id: number;
      name: string;
      version: string;
      category: string | null;
      description: string | null;
      config_json: Record<string, unknown>;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, version, category, description, config_json, is_active, created_at, updated_at
       FROM strategies
       WHERE name = $1 AND version = $2`,
      [name, versionToUse]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      name: row.name,
      version: row.version,
      category: row.category || undefined,
      description: row.description || undefined,
      config: row.config_json,
      isActive: row.is_active,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    };
  }

  /**
   * Create a new strategy
   */
  async create(data: StrategyInsertData): Promise<number> {
    const versionToUse = data.version || '1';
    const result = await getPostgresPool().query<{ id: number }>(
      `INSERT INTO strategies (name, version, category, description, config_json, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        data.name,
        versionToUse,
        data.category || null,
        data.description || null,
        JSON.stringify(data.config),
        data.isActive !== false, // Default to true
      ]
    );

    const strategyId = result.rows[0].id;
    logger.info('Created strategy', { id: strategyId, name: data.name, version: versionToUse });
    return strategyId;
  }

  /**
   * List all strategies
   */
  async list(): Promise<StrategyConfig[]> {
    const result = await getPostgresPool().query<{
      id: number;
      name: string;
      version: string;
      category: string | null;
      description: string | null;
      config_json: Record<string, unknown>;
      is_active: boolean;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, name, version, category, description, config_json, is_active, created_at, updated_at
       FROM strategies
       ORDER BY name, version DESC`
    );

    return result.rows.map((row) => ({
      name: row.name,
      version: row.version,
      category: row.category || undefined,
      description: row.description || undefined,
      config: row.config_json,
      isActive: row.is_active,
      createdAt: DateTime.fromJSDate(row.created_at),
      updatedAt: DateTime.fromJSDate(row.updated_at),
    }));
  }
}

