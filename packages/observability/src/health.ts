/**
 * Health Check Service
 * ====================
 * Monitors overall system health and provides health check endpoints.
 */

import { logger } from '@quantbot/utils';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { checkApiQuotas } from './quotas';
import { checkDatabaseHealth } from './database-health';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  checks: {
    postgres: { status: 'ok' | 'error' | 'warning'; message?: string };
    clickhouse: { status: 'ok' | 'error' | 'warning'; message?: string };
    birdeye: { status: 'ok' | 'warning' | 'error'; message?: string };
    helius: { status: 'ok' | 'warning' | 'error'; message?: string };
  };
}

/**
 * Perform comprehensive health check
 */
export async function performHealthCheck(): Promise<HealthStatus> {
  const checks: HealthStatus['checks'] = {
    postgres: { status: 'ok' },
    clickhouse: { status: 'ok' },
    birdeye: { status: 'ok' },
    helius: { status: 'ok' },
  };

  // Check PostgreSQL
  try {
    const pool = getPostgresPool();
    await pool.query('SELECT 1');
  } catch (error) {
    checks.postgres = {
      status: 'error',
      message: (error as Error).message,
    };
  }

  // Check ClickHouse
  try {
    const client = getClickHouseClient();
    await client.query({ query: 'SELECT 1', format: 'JSON' });
  } catch (error) {
    checks.clickhouse = {
      status: 'error',
      message: (error as Error).message,
    };
  }

  // Check API quotas
  try {
    const quotas = await checkApiQuotas();
    if (quotas.birdeye.remaining < quotas.birdeye.warningThreshold) {
      checks.birdeye = {
        status: quotas.birdeye.remaining === 0 ? 'error' : 'warning',
        message: `Low quota: ${quotas.birdeye.remaining}/${quotas.birdeye.limit}`,
      };
    }
    if (quotas.helius.remaining < quotas.helius.warningThreshold) {
      checks.helius = {
        status: quotas.helius.remaining === 0 ? 'error' : 'warning',
        message: `Low quota: ${quotas.helius.remaining}/${quotas.helius.limit}`,
      };
    }
  } catch (error) {
    logger.error('Failed to check API quotas', {
      error: error instanceof Error ? error.message : String(error),
    });
    checks.birdeye = { status: 'error', message: 'Failed to check quota' };
    checks.helius = { status: 'error', message: 'Failed to check quota' };
  }

  // Determine overall status
  const hasErrors = Object.values(checks).some((c) => c.status === 'error');
  const hasWarnings = Object.values(checks).some((c) => c.status === 'warning');

  const status: HealthStatus['status'] = hasErrors
    ? 'unhealthy'
    : hasWarnings
      ? 'degraded'
      : 'healthy';

  return {
    status,
    timestamp: new Date(),
    checks,
  };
}

/**
 * Simple health check endpoint (for load balancers)
 */
export async function simpleHealthCheck(): Promise<{ status: string }> {
  try {
    const pool = getPostgresPool();
    await pool.query('SELECT 1');
    return { status: 'ok' };
  } catch (error) {
    logger.error('Health check failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { status: 'error' };
  }
}
