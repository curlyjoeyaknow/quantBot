/**
 * Initialization Manager - Storage connections, health checks
 */

import { logger } from '@quantbot/utils';
import { initClickHouse, getClickHouseClient } from '@quantbot/storage';
import { getProgressIndicator } from './progress-indicator.js';
// PostgreSQL removed - getPostgresPool no longer available

/**
 * Initialization status
 */
export interface InitializationStatus {
  clickhouse: boolean;
  initialized: boolean;
}

/**
 * Initialize storage connections
 */
export async function initializeStorage(): Promise<InitializationStatus> {
  const status: InitializationStatus = {
    clickhouse: false,
    initialized: false,
  };

  const progress = getProgressIndicator();

  try {
    // Initialize ClickHouse
    try {
      progress.start('Initializing ClickHouse...');
      await initClickHouse();
      const client = getClickHouseClient();
      if (client) {
        status.clickhouse = true;
        progress.updateMessage('ClickHouse connected');
        logger.info('ClickHouse initialized');
      }
    } catch (error) {
      progress.updateMessage('ClickHouse initialization failed (continuing...)');
      logger.warn('ClickHouse initialization failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue - ClickHouse is optional
    }

    // PostgreSQL removed - no longer initialized

    status.initialized = status.clickhouse;

    if (!status.initialized) {
      progress.updateMessage('Warning: No storage backends initialized');
      logger.warn('No storage backends initialized. Some commands may not work.');
    } else {
      progress.succeed('Storage initialized');
    }

    return status;
  } catch (error) {
    progress.fail('Storage initialization error');
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
  };
}> {
  const details: {
    clickhouse?: { healthy: boolean; error?: string };
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

  // PostgreSQL removed - no longer checked

  const healthy = details.clickhouse?.healthy ?? false;

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
