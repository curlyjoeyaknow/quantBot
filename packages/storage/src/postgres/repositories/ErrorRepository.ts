/**
 * ErrorRepository - Postgres repository for error tracking
 *
 * Handles all database operations for error_events table.
 */

import { getPostgresPool } from '../postgres-client';
import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';

// ErrorEvent type - duplicated here to avoid circular dependency with @quantbot/observability
export interface ErrorEvent {
  timestamp: Date;
  error: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ErrorStats {
  total: number;
  bySeverity: Record<string, number>;
  recent: ErrorEvent[];
}

export class ErrorRepository {
  /**
   * Insert an error event
   */
  async insertError(event: ErrorEvent): Promise<number> {
    const pool = getPostgresPool();

    try {
      const result = await pool.query<{ id: number }>(
        `INSERT INTO error_events (timestamp, error_name, error_message, error_stack, severity, context_json, service)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          event.timestamp,
          event.error,
          event.message,
          event.stack || null,
          event.severity,
          event.context ? JSON.stringify(event.context) : null,
          null, // service field - not in ErrorEvent interface
        ]
      );

      const id = result.rows[0]?.id || 0;
      logger.debug('Inserted error event', { id, error: event.error, severity: event.severity });
      return id;
    } catch (error) {
      logger.error('Failed to insert error event', error as Error);
      throw error;
    }
  }

  /**
   * Get errors in a time range
   */
  async getErrors(timeRange: { from: Date; to: Date }): Promise<ErrorEvent[]> {
    const pool = getPostgresPool();

    try {
      const result = await pool.query<{
        id: number;
        timestamp: Date;
        error_name: string;
        error_message: string;
        error_stack: string | null;
        severity: string;
        context_json: string | null;
        service: string | null;
      }>(
        `SELECT id, timestamp, error_name, error_message, error_stack, severity, context_json, service
         FROM error_events
         WHERE timestamp >= $1 AND timestamp <= $2
         ORDER BY timestamp DESC
         LIMIT 1000`,
        [timeRange.from, timeRange.to]
      );

      return result.rows.map((row) => ({
        timestamp: row.timestamp,
        error: row.error_name,
        message: row.error_message,
        stack: row.error_stack || undefined,
        severity: row.severity as ErrorEvent['severity'],
        context: row.context_json ? JSON.parse(row.context_json) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to get errors', error as Error);
      throw error;
    }
  }

  /**
   * Get error statistics
   */
  async getErrorStats(timeRange: { from: Date; to: Date }): Promise<ErrorStats> {
    const pool = getPostgresPool();

    try {
      // Get total count and by severity
      const statsResult = await pool.query<{
        severity: string;
        count: string;
      }>(
        `SELECT severity, COUNT(*) as count
         FROM error_events
         WHERE timestamp >= $1 AND timestamp <= $2
         GROUP BY severity`,
        [timeRange.from, timeRange.to]
      );

      const totalResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) as count
         FROM error_events
         WHERE timestamp >= $1 AND timestamp <= $2`,
        [timeRange.from, timeRange.to]
      );

      const total = parseInt(totalResult.rows[0]?.count || '0', 10);
      const bySeverity: Record<string, number> = {};

      for (const row of statsResult.rows) {
        bySeverity[row.severity] = parseInt(row.count, 10);
      }

      // Get recent errors (last 50)
      const recent = await this.getErrors(timeRange);
      const recentErrors = recent.slice(0, 50);

      return {
        total,
        bySeverity,
        recent: recentErrors,
      };
    } catch (error) {
      logger.error('Failed to get error stats', error as Error);
      throw error;
    }
  }

  /**
   * Mark error as resolved
   */
  async markResolved(errorId: number): Promise<void> {
    const pool = getPostgresPool();

    try {
      await pool.query(`UPDATE error_events SET resolved = TRUE WHERE id = $1`, [errorId]);
      logger.debug('Marked error as resolved', { errorId });
    } catch (error) {
      logger.error('Failed to mark error as resolved', error as Error);
      throw error;
    }
  }
}
