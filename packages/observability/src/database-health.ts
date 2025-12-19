/**
 * Database Health Monitoring
 * ==========================
 * Monitors database connection health and performance.
 */

import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';

export interface DatabaseHealth {
  postgres: {
    connected: boolean;
    latency?: number;
    error?: string;
  };
  clickhouse: {
    connected: boolean;
    latency?: number;
    error?: string;
  };
}

/**
 * Check database health
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const health: DatabaseHealth = {
    postgres: { connected: false },
    clickhouse: { connected: false },
  };

  // Check PostgreSQL
  try {
    const start = Date.now();
    const pool = getPostgresPool();
    await pool.query('SELECT 1');
    health.postgres = {
      connected: true,
      latency: Date.now() - start,
    };
  } catch (error) {
    health.postgres = {
      connected: false,
      error: (error as Error).message,
    };
  }

  // Check ClickHouse
  try {
    const start = Date.now();
    const client = getClickHouseClient();
    await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    });
    health.clickhouse = {
      connected: true,
      latency: Date.now() - start,
    };
  } catch (error) {
    health.clickhouse = {
      connected: false,
      error: (error as Error).message,
    };
  }

  return health;
}
