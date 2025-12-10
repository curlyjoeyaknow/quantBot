/**
 * Health Check System
 * ===================
 * Comprehensive health check system for all services.
 */

import { ServiceContainer, ServiceHealth, ServiceStatus } from '../container/ServiceContainer';
import { logger } from '@quantbot/utils';
import { DatabaseError } from '@quantbot/utils/errors';

/**
 * Health check result
 */
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: Date;
  services: ServiceHealth[];
  summary: {
    total: number;
    healthy: number;
    degraded: number;
    unhealthy: number;
  };
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  timeout?: number;
  includeDetails?: boolean;
}

/**
 * Health check manager
 */
export class HealthCheckManager {
  private container: ServiceContainer;
  private checks: Map<string, () => Promise<ServiceHealth>> = new Map();

  constructor(container: ServiceContainer) {
    this.container = container;
    this.registerDefaultChecks();
  }

  /**
   * Register default health checks
   */
  private registerDefaultChecks(): void {
    // Database health check
    this.registerCheck('database', async () => {
      try {
        // Try to query a simple table to check database connectivity
        // This is a placeholder - actual implementation depends on your database
        return {
          name: 'database',
          status: ServiceStatus.RUNNING,
          healthy: true,
          lastCheck: new Date(),
        };
      } catch (error) {
        return {
          name: 'database',
          status: ServiceStatus.ERROR,
          healthy: false,
          lastCheck: new Date(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    // ClickHouse health check
    this.registerCheck('clickhouse', async () => {
      try {
        const { getClickHouseClient } = await import('@quantbot/storage');
        const client = getClickHouseClient();
        await client.ping();
        return {
          name: 'clickhouse',
          status: ServiceStatus.RUNNING,
          healthy: true,
          lastCheck: new Date(),
        };
      } catch (error) {
        return {
          name: 'clickhouse',
          status: ServiceStatus.ERROR,
          healthy: false,
          lastCheck: new Date(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });
  }

  /**
   * Register a custom health check
   */
  registerCheck(name: string, checkFn: () => Promise<ServiceHealth>): void {
    this.checks.set(name, checkFn);
    this.container.registerHealthCheck(name, checkFn);
  }

  /**
   * Run all health checks
   */
  async runHealthChecks(config: HealthCheckConfig = {}): Promise<HealthCheckResult> {
    const timeout = config.timeout || 5000;
    const timestamp = new Date();
    const services: ServiceHealth[] = [];

    // Get container health checks
    const containerHealth = await this.container.getHealthChecks();
    services.push(...containerHealth);

    // Run custom health checks
    const checkPromises = Array.from(this.checks.entries()).map(async ([name, checkFn]) => {
      try {
        const timeoutPromise = new Promise<ServiceHealth>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeout)
        );
        return await Promise.race([checkFn(), timeoutPromise]);
      } catch (error) {
        return {
          name,
          status: ServiceStatus.ERROR,
          healthy: false,
          lastCheck: new Date(),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const customHealth = await Promise.all(checkPromises);
    services.push(...customHealth);

    // Calculate summary
    const summary = {
      total: services.length,
      healthy: services.filter(s => s.healthy).length,
      degraded: services.filter(s => s.status === ServiceStatus.STOPPING).length,
      unhealthy: services.filter(s => !s.healthy).length,
    };

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (summary.unhealthy === 0 && summary.degraded === 0) {
      status = 'healthy';
    } else if (summary.unhealthy === 0) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      timestamp,
      services,
      summary,
    };
  }

  /**
   * Get health check result (cached for a short period)
   */
  private lastCheck: HealthCheckResult | null = null;
  private lastCheckTime: number = 0;
  private readonly CACHE_TTL = 5000; // 5 seconds

  async getHealthStatus(config: HealthCheckConfig = {}): Promise<HealthCheckResult> {
    const now = Date.now();
    if (
      this.lastCheck &&
      now - this.lastCheckTime < this.CACHE_TTL &&
      !config.includeDetails
    ) {
      return this.lastCheck;
    }

    const result = await this.runHealthChecks(config);
    this.lastCheck = result;
    this.lastCheckTime = now;
    return result;
  }

  /**
   * Check if system is healthy
   */
  async isHealthy(): Promise<boolean> {
    const result = await this.getHealthStatus();
    return result.status === 'healthy';
  }
}

/**
 * Create health check endpoint handler
 */
export function createHealthCheckHandler(container: ServiceContainer) {
  const manager = new HealthCheckManager(container);

  return async (): Promise<HealthCheckResult> => {
    return manager.getHealthStatus({ includeDetails: true });
  };
}

