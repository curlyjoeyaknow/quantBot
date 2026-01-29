/**
 * ClickHouse Service
 *
 * Service layer for ClickHouse operations (query OHLCV, store events, aggregate metrics).
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/infra/utils';
import { logger } from '@quantbot/infra/utils';

/**
 * Schema for OHLCV candle
 */
export const CandleSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export type Candle = z.infer<typeof CandleSchema>;

/**
 * Schema for OHLCV query result
 */
export const OHLCVQueryResultSchema = z.object({
  success: z.boolean(),
  candles: z.array(CandleSchema).optional(),
  count: z.number().optional(),
  error: z.string().optional(),
});

export type OHLCVQueryResult = z.infer<typeof OHLCVQueryResultSchema>;

/**
 * Schema for simulation event
 */
export const SimulationEventSchema = z.object({
  event_type: z.string(),
  timestamp: z.number(),
  price: z.number(),
  quantity: z.number().optional(),
  value_usd: z.number().optional(),
  pnl_usd: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SimulationEvent = z.infer<typeof SimulationEventSchema>;

/**
 * Schema for events storage result
 */
export const EventsStorageResultSchema = z.object({
  success: z.boolean(),
  stored_count: z.number().optional(),
  error: z.string().optional(),
});

export type EventsStorageResult = z.infer<typeof EventsStorageResultSchema>;

/**
 * Schema for metrics aggregation result
 */
export const MetricsResultSchema = z.object({
  success: z.boolean(),
  metrics: z
    .object({
      event_count: z.number().optional(),
      total_pnl: z.number().optional(),
      avg_pnl: z.number().optional(),
      min_pnl: z.number().optional(),
      max_pnl: z.number().optional(),
    })
    .optional(),
  error: z.string().optional(),
});

export type MetricsResult = z.infer<typeof MetricsResultSchema>;

/**
 * ClickHouse configuration
 */
export interface ClickHouseConfig {
  host: string;
  port: number;
  database: string;
  username?: string;
  password?: string;
}

/**
 * Get ClickHouse config from environment variables
 *
 * This function should ONLY be called in composition roots (CLI handlers, context factories).
 * Handlers should receive config as data, not read from env.
 */
export function getClickHouseConfigFromEnv(): ClickHouseConfig {
  return {
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: process.env.CLICKHOUSE_HTTP_PORT
      ? parseInt(process.env.CLICKHOUSE_HTTP_PORT)
      : process.env.CLICKHOUSE_PORT
        ? parseInt(process.env.CLICKHOUSE_PORT)
        : 18123, // Default to 18123 (Docker HTTP port)
    database: process.env.CLICKHOUSE_DATABASE || 'quantbot',
    username: process.env.CLICKHOUSE_USER || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
  };
}

/**
 * ClickHouse Service
 *
 * Pure service: accepts full config instead of reading from env.
 * Config resolution happens in composition roots (CLI handlers).
 */
export class ClickHouseService {
  constructor(
    private readonly pythonEngine: PythonEngine,
    private readonly config: ClickHouseConfig
  ) {}

  /**
   * Query OHLCV candles from ClickHouse
   */
  async queryOHLCV(
    tokenAddress: string,
    chain: string,
    startTime: string,
    endTime: string,
    interval: string = '5m'
  ): Promise<OHLCVQueryResult> {
    try {
      const result = await this.pythonEngine.runClickHouseEngine(
        {
          operation: 'query_ohlcv',
          data: {
            token_address: tokenAddress,
            chain,
            start_time: startTime,
            end_time: endTime,
            interval,
          },
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          username: this.config.username,
          password: this.config.password,
        },
        {
          env: {
            CLICKHOUSE_HOST: this.config.host,
            CLICKHOUSE_PORT: this.config.port.toString(),
            CLICKHOUSE_DATABASE: this.config.database,
            CLICKHOUSE_USERNAME: this.config.username || '',
            CLICKHOUSE_PASSWORD: this.config.password || '',
          },
        }
      );

      return OHLCVQueryResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to query OHLCV from ClickHouse', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Store simulation events in ClickHouse
   */
  async storeEvents(runId: string, events: SimulationEvent[]): Promise<EventsStorageResult> {
    try {
      const result = await this.pythonEngine.runClickHouseEngine(
        {
          operation: 'store_events',
          data: {
            run_id: runId,
            events,
          },
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          username: this.config.username,
          password: this.config.password,
        },
        {
          env: {
            CLICKHOUSE_HOST: this.config.host,
            CLICKHOUSE_PORT: this.config.port.toString(),
            CLICKHOUSE_DATABASE: this.config.database,
            CLICKHOUSE_USERNAME: this.config.username || '',
            CLICKHOUSE_PASSWORD: this.config.password || '',
          },
        }
      );

      return EventsStorageResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to store events in ClickHouse', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Aggregate metrics from simulation events
   */
  async aggregateMetrics(runId: string): Promise<MetricsResult> {
    try {
      const result = await this.pythonEngine.runClickHouseEngine(
        {
          operation: 'aggregate_metrics',
          data: {
            run_id: runId,
          },
          host: this.config.host,
          port: this.config.port,
          database: this.config.database,
          username: this.config.username,
          password: this.config.password,
        },
        {
          env: {
            CLICKHOUSE_HOST: this.config.host,
            CLICKHOUSE_PORT: this.config.port.toString(),
            CLICKHOUSE_DATABASE: this.config.database,
            CLICKHOUSE_USERNAME: this.config.username || '',
            CLICKHOUSE_PASSWORD: this.config.password || '',
          },
        }
      );

      return MetricsResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to aggregate metrics from ClickHouse', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
