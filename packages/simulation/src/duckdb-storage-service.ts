/**
 * DuckDB Storage Service
 *
 * Service layer for DuckDB storage operations (strategies, runs, alerts, reports).
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger } from '@quantbot/utils';

/**
 * Schema for strategy storage result
 */
export const StrategyStorageResultSchema = z.object({
  success: z.boolean(),
  strategy_id: z.string().optional(),
  error: z.string().nullable().optional(),
});

export type StrategyStorageResult = z.infer<typeof StrategyStorageResultSchema>;

/**
 * Schema for simulation run storage result
 */
export const RunStorageResultSchema = z.object({
  success: z.boolean(),
  run_id: z.string().optional(),
  strategy_config_id: z.string().optional(),
  error: z.string().nullable().optional(),
});

export type RunStorageResult = z.infer<typeof RunStorageResultSchema>;

/**
 * Schema for report generation result
 */
export const ReportResultSchema = z.object({
  success: z.boolean(),
  report_type: z.enum(['summary', 'strategy_performance']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().nullable().optional(),
});

export type ReportResult = z.infer<typeof ReportResultSchema>;

/**
 * Schema for alerts storage result
 */
export const AlertsStorageResultSchema = z.object({
  success: z.boolean(),
  stored_count: z.number().optional(),
  error: z.string().nullable().optional(),
});

export type AlertsStorageResult = z.infer<typeof AlertsStorageResultSchema>;

/**
 * Schema for calls query result
 */
export const CallsQueryResultSchema = z.object({
  success: z.boolean(),
  calls: z
    .array(
      z.object({
        mint: z.string(),
        alert_timestamp: z.string(), // ISO format timestamp
        caller_name: z.string().nullish(), // Can be string, null, or undefined
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type CallsQueryResult = z.infer<typeof CallsQueryResultSchema>;

/**
 * Schema for OHLCV metadata result
 */
export const OhlcvMetadataResultSchema = z.object({
  success: z.boolean(),
  available: z.boolean().optional(),
  time_range_start: z.string().optional(),
  time_range_end: z.string().optional(),
  candle_count: z.number().optional(),
  error: z.string().nullable().optional(),
});

export type OhlcvMetadataResult = z.infer<typeof OhlcvMetadataResultSchema>;

/**
 * Schema for OHLCV exclusion result
 */
export const OhlcvExclusionResultSchema = z.object({
  success: z.boolean(),
  excluded: z
    .array(
      z.object({
        mint: z.string(),
        alert_timestamp: z.string(),
        reason: z.string(),
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type OhlcvExclusionResult = z.infer<typeof OhlcvExclusionResultSchema>;

/**
 * DuckDB Storage Service
 */
export class DuckDBStorageService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Store a strategy in DuckDB
   */
  async storeStrategy(
    duckdbPath: string,
    strategyId: string,
    name: string,
    entryConfig: Record<string, unknown>,
    exitConfig: Record<string, unknown>,
    reentryConfig?: Record<string, unknown>,
    costConfig?: Record<string, unknown>
  ): Promise<StrategyStorageResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'store_strategy',
        data: {
          strategy_id: strategyId,
          name,
          entry_config: entryConfig,
          exit_config: exitConfig,
          reentry_config: reentryConfig,
          cost_config: costConfig,
        },
      });

      return StrategyStorageResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to store strategy', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Store a simulation run in DuckDB with strategy configuration
   * Stores both run metadata and exact strategy config for reproducibility
   */
  async storeRun(
    duckdbPath: string,
    runId: string,
    strategyId: string,
    strategyName: string,
    mint: string,
    alertTimestamp: string,
    startTime: string,
    endTime: string,
    initialCapital: number,
    strategyConfig: {
      entry: Record<string, unknown>;
      exit: Record<string, unknown>;
      reEntry?: Record<string, unknown>;
      costs?: Record<string, unknown>;
      stopLoss?: Record<string, unknown>;
      entrySignal?: Record<string, unknown>;
      exitSignal?: Record<string, unknown>;
    },
    callerName?: string,
    finalCapital?: number,
    totalReturnPct?: number,
    maxDrawdownPct?: number,
    sharpeRatio?: number,
    winRate?: number,
    totalTrades?: number
  ): Promise<RunStorageResult> {
    try {
      const data: Record<string, unknown> = {
        run_id: runId,
        strategy_id: strategyId,
        strategy_name: strategyName,
        mint,
        alert_timestamp: alertTimestamp,
        start_time: startTime,
        end_time: endTime,
        initial_capital: initialCapital,
        entry_config: strategyConfig.entry,
        exit_config: strategyConfig.exit,
      };

      if (callerName) data.caller_name = callerName;
      if (totalTrades !== undefined) data.total_trades = totalTrades;
      if (finalCapital !== undefined) data.final_capital = finalCapital;
      if (totalReturnPct !== undefined) data.total_return_pct = totalReturnPct;
      if (maxDrawdownPct !== undefined) data.max_drawdown_pct = maxDrawdownPct;
      if (sharpeRatio !== undefined) data.sharpe_ratio = sharpeRatio;
      if (winRate !== undefined) data.win_rate = winRate;
      if (strategyConfig.reEntry) data.reentry_config = strategyConfig.reEntry;
      if (strategyConfig.costs) data.cost_config = strategyConfig.costs;
      if (strategyConfig.stopLoss) data.stop_loss_config = strategyConfig.stopLoss;
      if (strategyConfig.entrySignal) data.entry_signal_config = strategyConfig.entrySignal;
      if (strategyConfig.exitSignal) data.exit_signal_config = strategyConfig.exitSignal;

      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'store_run',
        data,
      });

      return RunStorageResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to store simulation run', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Store alerts in DuckDB
   */
  async storeAlerts(
    duckdbPath: string,
    alerts: Array<Record<string, unknown>>
  ): Promise<AlertsStorageResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'store_alerts',
        data: { alerts },
      });

      return AlertsStorageResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to store alerts', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a report from DuckDB
   */
  async generateReport(
    duckdbPath: string,
    type: 'summary' | 'strategy_performance',
    strategyId?: string
  ): Promise<ReportResult> {
    try {
      const reportConfig: Record<string, unknown> = {
        type,
      };

      if (strategyId) {
        reportConfig.strategy_id = strategyId;
      }

      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'generate_report',
        data: reportConfig,
      });

      return ReportResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to generate report', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Query calls from DuckDB for batch simulation
   * Returns list of calls with mint addresses and alert timestamps
   */
  async queryCalls(
    duckdbPath: string,
    limit?: number,
    excludeUnrecoverable?: boolean,
    callerName?: string
  ): Promise<CallsQueryResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_calls',
        data: {
          limit: limit || 1000, // Default limit
          exclude_unrecoverable: excludeUnrecoverable !== false, // Default to true
          caller_name: callerName || undefined, // Pass caller_name if provided
        },
      });

      return CallsQueryResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to query calls from DuckDB', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update OHLCV metadata table
   */
  async updateOhlcvMetadata(
    duckdbPath: string,
    mint: string,
    alertTimestamp: string,
    intervalSeconds: number,
    timeRangeStart: string,
    timeRangeEnd: string,
    candleCount: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'update_ohlcv_metadata',
        data: {
          mint,
          alert_timestamp: alertTimestamp,
          interval_seconds: intervalSeconds,
          time_range_start: timeRangeStart,
          time_range_end: timeRangeEnd,
          candle_count: candleCount,
        },
      });

      return { success: result.success === true, error: result.error as string | undefined };
    } catch (error) {
      logger.error('Failed to update OHLCV metadata', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Query OHLCV metadata to check availability
   */
  async queryOhlcvMetadata(
    duckdbPath: string,
    mint: string,
    alertTimestamp: string,
    intervalSeconds: number,
    requiredStart?: string,
    requiredEnd?: string
  ): Promise<OhlcvMetadataResult> {
    try {
      const data: Record<string, unknown> = {
        mint,
        alert_timestamp: alertTimestamp,
        interval_seconds: intervalSeconds,
      };

      if (requiredStart) data.required_start = requiredStart;
      if (requiredEnd) data.required_end = requiredEnd;

      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_ohlcv_metadata',
        data,
      });

      return OhlcvMetadataResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to query OHLCV metadata', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if OHLCV data is available for given timeframes
   */
  async checkOhlcvAvailability(
    duckdbPath: string,
    mint: string,
    alertTimestamp: string,
    intervalSeconds: number,
    requiredStart: string,
    requiredEnd: string
  ): Promise<boolean> {
    const result = await this.queryOhlcvMetadata(
      duckdbPath,
      mint,
      alertTimestamp,
      intervalSeconds,
      requiredStart,
      requiredEnd
    );

    return result.success === true && result.available === true;
  }

  /**
   * Add token to OHLCV exclusions table
   */
  async addOhlcvExclusion(
    duckdbPath: string,
    mint: string,
    alertTimestamp: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'add_ohlcv_exclusion',
        data: {
          mint,
          alert_timestamp: alertTimestamp,
          reason,
        },
      });

      return { success: result.success === true, error: result.error as string | undefined };
    } catch (error) {
      logger.error('Failed to add OHLCV exclusion', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Query OHLCV exclusions to filter out excluded tokens
   */
  async queryOhlcvExclusions(
    duckdbPath: string,
    mints: string[],
    alertTimestamps: string[]
  ): Promise<OhlcvExclusionResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_ohlcv_exclusions',
        data: {
          mints,
          alert_timestamps: alertTimestamps,
        },
      });

      return OhlcvExclusionResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to query OHLCV exclusions', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
