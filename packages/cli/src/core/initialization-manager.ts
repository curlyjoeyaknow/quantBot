/**
 * Initialization Manager - Storage connections, health checks
 */

import { logger } from '@quantbot/utils';
import { initClickHouse, getClickHouseClient } from '@quantbot/storage';
import { getPostgresPool } from '@quantbot/storage';

/**
 * Initialization status
 */
export interface InitializationStatus {
  clickhouse: boolean;
  postgres: boolean;
  initialized: boolean;
}

/**
 * Initialize storage connections
 */
export async function initializeStorage(): Promise<InitializationStatus> {
  const status: InitializationStatus = {
    clickhouse: false,
    postgres: false,
    initialized: false,
  };

  try {
    // Initialize ClickHouse
    try {
      await initClickHouse();
      const client = getClickHouseClient();
      if (client) {
        status.clickhouse = true;
        logger.info('ClickHouse initialized');
      }
    } catch (error) {
      logger.warn('ClickHouse initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - ClickHouse is optional
    }

    // Initialize Postgres
    try {
      const pool = getPostgresPool();
      if (pool) {
        // Test connection
        await pool.query('SELECT 1');
        status.postgres = true;
        logger.info('PostgreSQL initialized');
      }
    } catch (error) {
      logger.warn('PostgreSQL initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - may be optional for some commands
    }

    status.initialized = status.clickhouse || status.postgres;

    if (!status.initialized) {
      logger.warn('No storage backends initialized. Some commands may not work.');
    }

    return status;
  } catch (error) {
    logger.error('Storage initialization error', error as Error);
    throw error;
  }
}

/**
 * Health check for storage connections
 */
export async function checkStorageHealth(): Promise<{
  healthy: boolean;
  details: {
    clickhouse?: { healthy: boolean; error?: string };
    postgres?: { healthy: boolean; error?: string };
  };
}> {
  const details: {
    clickhouse?: { healthy: boolean; error?: string };
    postgres?: { healthy: boolean; error?: string };
  } = {};

  // Check ClickHouse
  try {
    const client = getClickHouseClient();
    if (client) {
      await client.ping();
      details.clickhouse = { healthy: true };
    } else {
      details.clickhouse = { healthy: false, error: 'Not initialized' };
    }
  } catch (error) {
    details.clickhouse = {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  // Check Postgres
  try {
    const pool = getPostgresPool();
    if (pool) {
      await pool.query('SELECT 1');
      details.postgres = { healthy: true };
    } else {
      details.postgres = { healthy: false, error: 'Not initialized' };
    }
  } catch (error) {
    details.postgres = {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  const healthy = (details.clickhouse?.healthy ?? false) || (details.postgres?.healthy ?? false);

  return { healthy, details };
}

/**
 * Lazy initialization - initialize storage only when needed
 */
let initializationPromise: Promise<InitializationStatus> | null = null;

export async function ensureInitialized(): Promise<InitializationStatus> {
  if (!initializationPromise) {
    initializationPromise = initializeStorage();
  }
  return initializationPromise;
}
