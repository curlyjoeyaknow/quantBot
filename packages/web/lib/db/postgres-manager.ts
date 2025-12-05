/**
 * PostgreSQL Database Manager for Web Dashboard
 * Replaces the old SQLite db-manager
 */

import { Pool, PoolClient } from 'pg';
import { config } from 'dotenv';

config();

class PostgresManager {
  private static instance: PostgresManager;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): PostgresManager {
    if (!PostgresManager.instance) {
      PostgresManager.instance = new PostgresManager();
    }
    return PostgresManager.instance;
  }

  getPool(): Pool {
    if (this.pool) {
      return this.pool;
    }

    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'quantbot',
      password: process.env.POSTGRES_PASSWORD || '',
      database: process.env.POSTGRES_DATABASE || 'quantbot',
      max: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '10'),
    });

    return this.pool;
  }

  async getClient(): Promise<PoolClient> {
    const pool = this.getPool();
    return await pool.connect();
  }

  async query(text: string, params?: any[]) {
    const pool = this.getPool();
    return await pool.query(text, params);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.query('SELECT 1');
      return result.rows.length > 0;
    } catch (error) {
      console.error('PostgreSQL health check failed:', error);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export const postgresManager = PostgresManager.getInstance();

