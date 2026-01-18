/**
 * Error Tracking
 * ==============
 * Tracks and aggregates application errors for observability.
 * Uses DuckDB ErrorRepository for persistent storage.
 */

import { logger } from '@quantbot/infra/utils';
import { join } from 'path';
import { ErrorRepository, type ErrorEvent as StorageErrorEvent } from '@quantbot/infra/storage';

export interface ErrorEvent {
  timestamp: Date;
  error: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ErrorTrackingConfig {
  /**
   * Path to DuckDB database file for error storage
   * @default 'data/databases/errors.db'
   */
  dbPath?: string;
  /**
   * Service name to tag errors with
   */
  service?: string;
}

/**
 * Singleton ErrorRepository instance
 */
let errorRepositoryInstance: ErrorRepository | null = null;

/**
 * Get or create the singleton ErrorRepository instance
 */
function getErrorRepository(config?: ErrorTrackingConfig): ErrorRepository | null {
  if (!errorRepositoryInstance) {
    if (!config) {
      // Use default path if no config provided
      const defaultPath =
        process.env.ERROR_DB_PATH || join(process.cwd(), 'data', 'databases', 'errors.db');
      errorRepositoryInstance = new ErrorRepository(defaultPath);
    } else {
      const dbPath =
        config.dbPath ||
        process.env.ERROR_DB_PATH ||
        join(process.cwd(), 'data', 'databases', 'errors.db');
      errorRepositoryInstance = new ErrorRepository(dbPath);
    }
  }
  return errorRepositoryInstance;
}

/**
 * Reset the singleton instance (for testing only)
 * @internal
 */
export function _resetErrorRepository(): void {
  errorRepositoryInstance = null;
}

/**
 * Track an error event
 */
export async function trackError(
  error: Error,
  context?: Record<string, unknown>,
  severity: ErrorEvent['severity'] = 'medium',
  config?: ErrorTrackingConfig
): Promise<void> {
  try {
    const repo = getErrorRepository(config);
    if (!repo) {
      // Fallback to logging only if repository initialization failed
      logger.error('Error tracked (repository unavailable)', error, { context, severity });
      return;
    }

    // Extract service from context or config
    const service = config?.service || (context?.service as string | undefined);

    await repo.insertError({
      timestamp: new Date(),
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      severity,
      context,
      service,
    });

    logger.error('Error tracked', error, { context, severity, service });
  } catch (dbError) {
    // Don't fail if error tracking fails - just log it
    logger.error('Failed to track error in database', dbError as Error, {
      originalError: error.message,
    });
    // Still log the original error
    logger.error('Error occurred', error, { context, severity });
  }
}

/**
 * Get error statistics
 */
export async function getErrorStats(
  timeRange: { from: Date; to: Date },
  config?: ErrorTrackingConfig
): Promise<{
  total: number;
  bySeverity: Record<string, number>;
  recent: ErrorEvent[];
}> {
  try {
    const repo = getErrorRepository(config);
    if (!repo) {
      logger.warn('Error repository unavailable, returning empty stats');
      return {
        total: 0,
        bySeverity: {},
        recent: [],
      };
    }

    const stats = await repo.getStats({
      startDate: timeRange.from,
      endDate: timeRange.to,
      service: config?.service,
    });

    const recentErrors = await repo.getRecentErrors({
      startDate: timeRange.from,
      endDate: timeRange.to,
      service: config?.service,
      limit: 10,
    });

    // Convert storage ErrorEvent to public ErrorEvent format
    const recent: ErrorEvent[] = recentErrors.map((e: StorageErrorEvent) => ({
      timestamp: e.timestamp.toJSDate(),
      error: e.errorName,
      message: e.errorMessage,
      stack: e.errorStack,
      context: e.context,
      severity: e.severity,
    }));

    return {
      total: stats.total,
      bySeverity: {
        critical: stats.bySeverity.critical,
        high: stats.bySeverity.high,
        medium: stats.bySeverity.medium,
        low: stats.bySeverity.low,
      },
      recent,
    };
  } catch (error) {
    logger.error('Failed to get error stats', {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      total: 0,
      bySeverity: {},
      recent: [],
    };
  }
}

/**
 * Get recent errors
 */
export async function getRecentErrors(
  limit: number = 10,
  options?: {
    startDate?: Date;
    endDate?: Date;
    severity?: ErrorEvent['severity'];
    service?: string;
    resolved?: boolean;
  },
  config?: ErrorTrackingConfig
): Promise<ErrorEvent[]> {
  try {
    const repo = getErrorRepository(config);
    if (!repo) {
      logger.warn('Error repository unavailable');
      return [];
    }

    const errors = await repo.getRecentErrors({
      limit,
      startDate: options?.startDate,
      endDate: options?.endDate,
      severity: options?.severity,
      service: options?.service || config?.service,
      resolved: options?.resolved,
    });

    return errors.map((e: StorageErrorEvent) => ({
      timestamp: e.timestamp.toJSDate(),
      error: e.errorName,
      message: e.errorMessage,
      stack: e.errorStack,
      context: e.context,
      severity: e.severity,
    }));
  } catch (error) {
    logger.error('Failed to get recent errors', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Mark an error as resolved
 */
export async function markErrorResolved(
  errorId: number,
  config?: ErrorTrackingConfig
): Promise<void> {
  try {
    const repo = getErrorRepository(config);
    if (!repo) {
      logger.warn('Error repository unavailable');
      return;
    }

    await repo.markResolved(errorId);
    logger.info('Error marked as resolved', { errorId });
  } catch (error) {
    logger.error('Failed to mark error as resolved', {
      error: error instanceof Error ? error.message : String(error),
      errorId,
    });
  }
}

/**
 * Get errors by error name (for pattern analysis)
 */
export async function getErrorsByName(
  errorName: string,
  limit: number = 10,
  config?: ErrorTrackingConfig
): Promise<ErrorEvent[]> {
  try {
    const repo = getErrorRepository(config);
    if (!repo) {
      logger.warn('Error repository unavailable');
      return [];
    }

    const errors = await repo.getByErrorName(errorName, limit);

    return errors.map((e: StorageErrorEvent) => ({
      timestamp: e.timestamp.toJSDate(),
      error: e.errorName,
      message: e.errorMessage,
      stack: e.errorStack,
      context: e.context,
      severity: e.severity,
    }));
  } catch (error) {
    logger.error('Failed to get errors by name', {
      error: error instanceof Error ? error.message : String(error),
      errorName,
    });
    return [];
  }
}
