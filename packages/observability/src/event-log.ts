/**
 * DuckDB Event Log Service
 * ========================
 * Billing-grade event log for API calls with cost, status, latency, and run_id tracking.
 * Uses DuckDB for efficient storage and querying via Python engine.
 */

import { logger, PythonEngine, AppError, ConfigurationError } from '@quantbot/infra/utils';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { join } from 'path';

/**
 * Event log entry schema
 */
export const EventLogEntrySchema = z.object({
  id: z.string().uuid().optional(),
  timestamp: z.date(),
  api_name: z.string(),
  endpoint: z.string(),
  method: z.string().default('GET'),
  status_code: z.number().nullable(),
  success: z.boolean(),
  latency_ms: z.number(),
  credits_cost: z.number().default(0),
  run_id: z.string().optional(),
  error_message: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /**
   * Time window in minutes to check credits
   */
  windowMinutes: number;
  /**
   * Maximum credits allowed in the window
   */
  threshold: number;
  /**
   * Whether circuit breaker is enabled
   */
  enabled: boolean;
}

/**
 * Event log service configuration
 */
export interface EventLogConfig {
  /**
   * Path to DuckDB database file
   */
  dbPath: string;
  /**
   * Circuit breaker configuration
   */
  circuitBreaker?: CircuitBreakerConfig;
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  tripped: boolean;
  trippedAt: Date | null;
  lastCheck: Date;
}

/**
 * DuckDB Event Log Service
 */
export class EventLogService {
  private pythonEngine: PythonEngine;
  private dbPath: string;
  private circuitBreaker: CircuitBreakerConfig;
  private circuitState: CircuitBreakerState = {
    tripped: false,
    trippedAt: null,
    lastCheck: new Date(),
  };

  constructor(config: EventLogConfig) {
    this.dbPath = config.dbPath;
    this.circuitBreaker = config.circuitBreaker || {
      windowMinutes: 60,
      threshold: 1000000, // 1M credits default
      enabled: true,
    };
    this.pythonEngine = new PythonEngine();
    this.initializeDatabase();
  }

  /**
   * Initialize DuckDB database and schema via Python
   */
  private async initializeDatabase(): Promise<void> {
    try {
      const scriptPath = join(process.cwd(), 'tools/observability/event_log.py');
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      });

      await this.pythonEngine.runScript(
        scriptPath,
        {
          operation: 'init',
          'db-path': this.dbPath,
        },
        resultSchema
      );

      logger.info('Event log database initialized', { dbPath: this.dbPath });
    } catch (error) {
      logger.error('Failed to initialize event log database', error as Error, {
        dbPath: this.dbPath,
      });
      // Don't throw - allow service to continue with degraded functionality
    }
  }

  /**
   * Log an API call event
   */
  async logEvent(entry: Omit<EventLogEntry, 'id'>): Promise<void> {
    // Check circuit breaker before logging
    if (this.circuitBreaker.enabled) {
      const shouldBlock = await this.checkCircuitBreaker();
      if (shouldBlock) {
        logger.warn('Circuit breaker tripped - blocking API call', {
          apiName: entry.api_name,
          endpoint: entry.endpoint,
          trippedAt: this.circuitState.trippedAt,
        });
        throw new AppError(
          `Circuit breaker tripped: Credits exceeded threshold (${this.circuitBreaker.threshold}) in last ${this.circuitBreaker.windowMinutes} minutes`,
          'CIRCUIT_BREAKER_TRIPPED',
          503,
          {
            threshold: this.circuitBreaker.threshold,
            windowMinutes: this.circuitBreaker.windowMinutes,
            entry,
          }
        );
      }
    }

    try {
      const id = crypto.randomUUID();
      const validated = EventLogEntrySchema.parse({ ...entry, id });

      const scriptPath = join(process.cwd(), 'tools/observability/event_log.py');
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      });

      await this.pythonEngine.runScript(
        scriptPath,
        {
          operation: 'log',
          'db-path': this.dbPath,
          event: JSON.stringify({
            id: validated.id,
            timestamp: validated.timestamp.toISOString(),
            api_name: validated.api_name,
            endpoint: validated.endpoint,
            method: validated.method,
            status_code: validated.status_code,
            success: validated.success,
            latency_ms: validated.latency_ms,
            credits_cost: validated.credits_cost,
            run_id: validated.run_id,
            error_message: validated.error_message,
            metadata: validated.metadata,
          }),
        },
        resultSchema
      );

      logger.debug('Event logged', {
        apiName: validated.api_name,
        endpoint: validated.endpoint,
        creditsCost: validated.credits_cost,
      });
    } catch (error) {
      logger.error('Failed to log event', error as Error, {
        apiName: entry.api_name,
        endpoint: entry.endpoint,
      });
      // Don't throw - event logging should not break application flow
    }
  }

  /**
   * Check circuit breaker status
   */
  private async checkCircuitBreaker(): Promise<boolean> {
    if (!this.circuitBreaker.enabled) {
      return false;
    }

    try {
      const windowStart = DateTime.now()
        .minus({ minutes: this.circuitBreaker.windowMinutes })
        .toJSDate();

      const scriptPath = join(process.cwd(), 'tools/observability/event_log.py');
      const resultSchema = z.object({
        total_credits: z.number(),
      });

      const result = await this.pythonEngine.runScript(
        scriptPath,
        {
          operation: 'get_credits_in_window',
          'db-path': this.dbPath,
          'window-start': windowStart.toISOString(),
        },
        resultSchema
      );

      const totalCredits = result.total_credits || 0;

      if (totalCredits >= this.circuitBreaker.threshold) {
        if (!this.circuitState.tripped) {
          this.circuitState.tripped = true;
          this.circuitState.trippedAt = new Date();
          logger.error('Circuit breaker TRIPPED', {
            totalCredits,
            threshold: this.circuitBreaker.threshold,
            windowMinutes: this.circuitBreaker.windowMinutes,
          });
        }
        return true;
      } else {
        // Reset if below threshold
        if (this.circuitState.tripped) {
          logger.info('Circuit breaker RESET', {
            totalCredits,
            threshold: this.circuitBreaker.threshold,
          });
          this.circuitState.tripped = false;
          this.circuitState.trippedAt = null;
        }
        return false;
      }
    } catch (error) {
      logger.error('Failed to check circuit breaker', error as Error);
      // On error, don't block (fail open)
      return false;
    }
  }

  /**
   * Get credits spent in last N minutes
   */
  async getCreditsInWindow(minutes: number): Promise<number> {
    try {
      const windowStart = DateTime.now().minus({ minutes }).toJSDate();

      const scriptPath = join(process.cwd(), 'tools/observability/event_log.py');
      const resultSchema = z.object({
        total_credits: z.number(),
      });

      const result = await this.pythonEngine.runScript(
        scriptPath,
        {
          operation: 'get_credits_in_window',
          'db-path': this.dbPath,
          'window-start': windowStart.toISOString(),
        },
        resultSchema
      );

      return result.total_credits || 0;
    } catch (error) {
      logger.error('Failed to get credits in window', error as Error);
      return 0;
    }
  }

  /**
   * Get event log statistics
   */
  async getStats(
    apiName?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalEvents: number;
    totalCredits: number;
    successRate: number;
    avgLatency: number;
    errorCount: number;
  }> {
    try {
      const scriptPath = join(process.cwd(), 'tools/observability/event_log.py');
      const resultSchema = z.object({
        total_events: z.number(),
        total_credits: z.number(),
        success_rate: z.number(),
        avg_latency: z.number(),
        error_count: z.number(),
      });

      const result = await this.pythonEngine.runScript(
        scriptPath,
        {
          operation: 'get_stats',
          'db-path': this.dbPath,
          'api-name': apiName,
          'start-date': startDate?.toISOString(),
          'end-date': endDate?.toISOString(),
        },
        resultSchema
      );

      return {
        totalEvents: result.total_events || 0,
        totalCredits: result.total_credits || 0,
        successRate: (result.success_rate || 0) * 100,
        avgLatency: result.avg_latency || 0,
        errorCount: result.error_count || 0,
      };
    } catch (error) {
      logger.error('Failed to get event log stats', error as Error);
      throw error;
    }
  }

  /**
   * Check if circuit breaker is tripped
   */
  isCircuitBreakerTripped(): boolean {
    return this.circuitState.tripped;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    // Python engine handles cleanup automatically
    logger.info('Event log service closed');
  }
}

/**
 * Singleton instance
 */
let eventLogInstance: EventLogService | null = null;

/**
 * Get or create the singleton EventLogService instance
 */
export function getEventLogService(config?: EventLogConfig): EventLogService {
  if (!eventLogInstance) {
    if (!config) {
      throw new ConfigurationError(
        'EventLogService config required for first initialization',
        'EventLogService'
      );
    }
    eventLogInstance = new EventLogService(config);
  }
  return eventLogInstance;
}
