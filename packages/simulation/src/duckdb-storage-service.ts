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
  error: z.string().optional(),
});

export type StrategyStorageResult = z.infer<typeof StrategyStorageResultSchema>;

/**
 * Schema for simulation run storage result
 */
export const RunStorageResultSchema = z.object({
  success: z.boolean(),
  run_id: z.string().optional(),
  error: z.string().optional(),
});

export type RunStorageResult = z.infer<typeof RunStorageResultSchema>;

/**
 * Schema for report generation result
 */
export const ReportResultSchema = z.object({
  success: z.boolean(),
  report_type: z.enum(['summary', 'strategy_performance']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export type ReportResult = z.infer<typeof ReportResultSchema>;

/**
 * Schema for alerts storage result
 */
export const AlertsStorageResultSchema = z.object({
  success: z.boolean(),
  stored_count: z.number().optional(),
  error: z.string().optional(),
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
      })
    )
    .optional(),
  error: z.string().optional(),
});

export type CallsQueryResult = z.infer<typeof CallsQueryResultSchema>;

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
   * Store a simulation run in DuckDB
   */
  async storeRun(
    duckdbPath: string,
    runId: string,
    strategyId: string,
    mint: string,
    alertTimestamp: string,
    startTime: string,
    endTime: string,
    initialCapital: number,
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
        mint,
        alert_timestamp: alertTimestamp,
        start_time: startTime,
        end_time: endTime,
        initial_capital: initialCapital,
      };

      if (totalTrades !== undefined) data.total_trades = totalTrades;
      if (finalCapital !== undefined) data.final_capital = finalCapital;
      if (totalReturnPct !== undefined) data.total_return_pct = totalReturnPct;
      if (maxDrawdownPct !== undefined) data.max_drawdown_pct = maxDrawdownPct;
      if (sharpeRatio !== undefined) data.sharpe_ratio = sharpeRatio;
      if (winRate !== undefined) data.win_rate = winRate;

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
  async queryCalls(duckdbPath: string, limit?: number): Promise<CallsQueryResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_calls',
        data: {
          limit: limit || 1000, // Default limit
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
}
