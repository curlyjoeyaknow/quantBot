/**
 * Error Tracking
 * ==============
 * Tracks and aggregates application errors for observability.
 */

import { logger } from '@quantbot/utils';

export interface ErrorEvent {
  timestamp: Date;
  error: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// In-memory error tracking (until ErrorRepository is implemented in storage)
const errorStore: ErrorEvent[] = [];
const MAX_STORED_ERRORS = 1000;

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
    // Store in memory (FIFO, max 1000)
    errorStore.push(event);
    if (errorStore.length > MAX_STORED_ERRORS) {
      errorStore.shift();
    }
    
    logger.error('Error tracked', error, { context, severity });
  } catch (dbError) {
    // Don't fail if error tracking fails - just log it
    logger.error('Failed to track error', dbError as Error, {
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
    const filtered = errorStore.filter(
      (e) => e.timestamp >= timeRange.from && e.timestamp <= timeRange.to
    );

    const total = filtered.length;
    const bySeverity: Record<string, number> = {};
    filtered.forEach((e) => {
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
    });

    const recent = filtered
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10)
      .map((e) => ({
        timestamp: e.timestamp,
        error: e.error,
        message: e.message,
        severity: e.severity,
        context: e.context,
      }));

    return {
      total,
      bySeverity,
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
