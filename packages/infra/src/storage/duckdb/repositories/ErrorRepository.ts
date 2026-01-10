/**
 * ErrorRepository - DuckDB repository for error tracking
 *
 * Tracks and queries application errors for observability and debugging.
 * Provides persistent storage for error events with severity, context, and resolution tracking.
 */

import { DateTime } from 'luxon';
import { logger, DatabaseError } from '../../../utils/index.js';
import { join } from 'path';
import { z } from 'zod';
import { DuckDBClient } from '../duckdb-client.js';

export interface ErrorEvent {
  id: number;
  timestamp: DateTime;
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  service?: string;
  resolved: boolean;
  createdAt: DateTime;
}

export interface ErrorInsertData {
  timestamp: Date;
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  context?: Record<string, unknown>;
  service?: string;
}

export interface ErrorStats {
  total: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  resolvedCount: number;
}

export interface ErrorQueryOptions {
  startDate?: Date;
  endDate?: Date;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  service?: string;
  resolved?: boolean;
  limit?: number;
}

/**
 * DuckDB ErrorRepository
 */
export class ErrorRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    this.scriptPath = join(process.cwd(), 'tools/storage/duckdb_errors.py');
    this.initializeDatabase();
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('ErrorRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize ErrorRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      // CRITICAL: Always throw - silent failures give false confidence in results
      // If database initialization fails, subsequent operations will also fail.
      // Better to fail fast and surface the error than silently continue with broken state.
      throw new DatabaseError(
        'ErrorRepository database initialization failed',
        'initializeDatabase',
        {
          dbPath: this.client.getDbPath(),
          originalError: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Insert an error event
   */
  async insertError(data: ErrorInsertData): Promise<ErrorEvent> {
    try {
      const resultSchema = z.object({
        id: z.number(),
        timestamp: z.string(),
        error_name: z.string(),
        error_message: z.string(),
        error_stack: z.string().nullable(),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        context_json: z.record(z.string(), z.unknown()).nullable(),
        service: z.string().nullable(),
        resolved: z.boolean(),
        created_at: z.string(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'insert',
        {
          timestamp: data.timestamp.toISOString(),
          'error-name': data.errorName,
          'error-message': data.errorMessage,
          'error-stack': data.errorStack || null,
          severity: data.severity || 'medium',
          'context-json': data.context ? JSON.stringify(data.context) : null,
          service: data.service || null,
        },
        resultSchema
      );

      return {
        id: result.id,
        timestamp: DateTime.fromISO(result.timestamp),
        errorName: result.error_name,
        errorMessage: result.error_message,
        errorStack: result.error_stack || undefined,
        severity: result.severity,
        context: result.context_json || undefined,
        service: result.service || undefined,
        resolved: result.resolved,
        createdAt: DateTime.fromISO(result.created_at),
      };
    } catch (error) {
      logger.error('Failed to insert error', error as Error, {
        errorName: data.errorName,
        severity: data.severity,
      });
      throw error;
    }
  }

  /**
   * Get error statistics
   */
  async getStats(options?: ErrorQueryOptions): Promise<ErrorStats> {
    try {
      const resultSchema = z.object({
        total: z.number(),
        by_severity: z.object({
          critical: z.number(),
          high: z.number(),
          medium: z.number(),
          low: z.number(),
        }),
        resolved_count: z.number(),
        error: z.string().optional(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'get_stats',
        {
          'start-date': options?.startDate?.toISOString() || null,
          'end-date': options?.endDate?.toISOString() || null,
          severity: options?.severity || null,
          service: options?.service || null,
        },
        resultSchema
      );

      if (result.error) {
        throw new DatabaseError(result.error, 'getStats', { result });
      }

      return {
        total: result.total,
        bySeverity: result.by_severity,
        resolvedCount: result.resolved_count,
      };
    } catch (error) {
      logger.error('Failed to get error stats', error as Error);
      throw error;
    }
  }

  /**
   * Get recent errors
   */
  async getRecentErrors(options?: ErrorQueryOptions): Promise<ErrorEvent[]> {
    try {
      const resultSchema = z.array(
        z.object({
          id: z.number(),
          timestamp: z.string(),
          error_name: z.string(),
          error_message: z.string(),
          error_stack: z.string().nullable(),
          severity: z.enum(['low', 'medium', 'high', 'critical']),
          context_json: z.record(z.string(), z.unknown()).nullable(),
          service: z.string().nullable(),
          resolved: z.boolean(),
          created_at: z.string(),
        })
      );

      const result = await this.client.execute(
        this.scriptPath,
        'get_recent',
        {
          limit: options?.limit || 10,
          'start-date': options?.startDate?.toISOString() || null,
          'end-date': options?.endDate?.toISOString() || null,
          severity: options?.severity || null,
          service: options?.service || null,
          resolved: options?.resolved !== undefined ? options.resolved : null,
        },
        resultSchema
      );

      // Ensure we always return an array, even if result is null/undefined
      if (!result || !Array.isArray(result)) {
        return [];
      }

      return result.map((row) => ({
        id: row.id,
        timestamp: DateTime.fromISO(row.timestamp),
        errorName: row.error_name,
        errorMessage: row.error_message,
        errorStack: row.error_stack || undefined,
        severity: row.severity,
        context: row.context_json || undefined,
        service: row.service || undefined,
        resolved: row.resolved,
        createdAt: DateTime.fromISO(row.created_at),
      }));
    } catch (error) {
      logger.error('Failed to get recent errors', error as Error);
      throw error;
    }
  }

  /**
   * Mark an error as resolved
   */
  async markResolved(errorId: number): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'mark_resolved',
        { id: errorId },
        resultSchema
      );

      if (!result.success && result.error) {
        throw new DatabaseError(result.error, 'markResolved', { result, errorId });
      }

      logger.info('Error marked as resolved', { errorId });
    } catch (error) {
      logger.error('Failed to mark error as resolved', error as Error, { errorId });
      throw error;
    }
  }

  /**
   * Get errors by error name (for pattern analysis)
   */
  async getByErrorName(errorName: string, limit: number = 10): Promise<ErrorEvent[]> {
    try {
      const resultSchema = z.array(
        z.object({
          id: z.number(),
          timestamp: z.string(),
          error_name: z.string(),
          error_message: z.string(),
          error_stack: z.string().nullable(),
          severity: z.enum(['low', 'medium', 'high', 'critical']),
          context_json: z.record(z.string(), z.unknown()).nullable(),
          service: z.string().nullable(),
          resolved: z.boolean(),
          created_at: z.string(),
        })
      );

      const result = await this.client.execute(
        this.scriptPath,
        'get_by_error_name',
        {
          'error-name': errorName,
          limit,
        },
        resultSchema
      );

      // Ensure we always return an array, even if result is null/undefined
      if (!result || !Array.isArray(result)) {
        return [];
      }

      return result.map((row) => ({
        id: row.id,
        timestamp: DateTime.fromISO(row.timestamp),
        errorName: row.error_name,
        errorMessage: row.error_message,
        errorStack: row.error_stack || undefined,
        severity: row.severity,
        context: row.context_json || undefined,
        service: row.service || undefined,
        resolved: row.resolved,
        createdAt: DateTime.fromISO(row.created_at),
      }));
    } catch (error) {
      logger.error('Failed to get errors by name', error as Error, { errorName });
      throw error;
    }
  }
}
