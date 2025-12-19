/**
 * Error Tracking
 * ==============
 * Tracks and aggregates application errors for observability.
 */

import { logger } from '@quantbot/utils';
// TODO: ErrorRepository needs to be implemented in storage package
// import { ErrorRepository } from '@quantbot/storage';

export interface ErrorEvent {
  timestamp: Date;
  error: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// TODO: ErrorRepository needs to be implemented in storage package
// Singleton repository instance
// let errorRepository: ErrorRepository | null = null;

// function getErrorRepository(): ErrorRepository {
//   if (!errorRepository) {
//     errorRepository = new ErrorRepository();
//   }
//   return errorRepository;
// }

/**
 * Track an error event
 */
export async function trackError(
  error: Error,
  context?: Record<string, unknown>,
  severity: ErrorEvent['severity'] = 'medium'
): Promise<void> {
  const event: ErrorEvent = {
    timestamp: new Date(),
    error: error.name,
    message: error.message,
    stack: error.stack,
    context,
    severity,
  };

  try {
    // TODO: Implement ErrorRepository in storage package
    // const repo = getErrorRepository();
    // await repo.insertError(event);
    logger.error('Error tracked', error, { context, severity });
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
export async function getErrorStats(timeRange: { from: Date; to: Date }): Promise<{
  total: number;
  bySeverity: Record<string, number>;
  recent: ErrorEvent[];
}> {
  try {
    // TODO: Implement ErrorRepository in storage package
    // const repo = getErrorRepository();
    // return await repo.getErrorStats(timeRange);
    logger.warn('ErrorRepository not implemented - returning empty stats');
    return {
      total: 0,
      bySeverity: {},
      recent: [],
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
