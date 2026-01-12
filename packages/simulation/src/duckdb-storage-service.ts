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
        price_usd: z.number().positive().nullable().optional(), // Entry price from user_calls_d
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
        token_address: z.string(),
        chain: z.string(),
        interval: z.string(),
        reason: z.string(),
        excluded_at: z.string(),
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type OhlcvExclusionResult = z.infer<typeof OhlcvExclusionResultSchema>;

/**
 * Schema for tokens query result
 */
export const TokensQueryResultSchema = z.object({
  success: z.boolean(),
  tokens: z
    .array(
      z.object({
        mint: z.string(),
        chain: z.string(),
        earliest_call_timestamp: z.string(), // ISO format timestamp
        call_count: z.number(),
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type TokensQueryResult = z.infer<typeof TokensQueryResultSchema>;

/**
 * Schema for token creation info storage result
 */
export const TokenCreationInfoStorageResultSchema = z.object({
  success: z.boolean(),
  stored_count: z.number().optional(),
  error: z.string().nullable().optional(),
});

export type TokenCreationInfoStorageResult = z.infer<typeof TokenCreationInfoStorageResultSchema>;

/**
 * Schema for address validation result
 */
export const ValidateAddressesResultSchema = z.object({
  success: z.boolean(),
  total_addresses: z.number(),
  valid_addresses: z.number(),
  faulty_addresses: z.number(),
  faulty: z
    .array(
      z.object({
        mint: z.string(),
        table_name: z.string(),
        row_count: z.number(),
        error: z.string(),
        address_length: z.number(),
        address_type: z.string(), // 'solana', 'evm', or 'unknown'
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type ValidateAddressesResult = z.infer<typeof ValidateAddressesResultSchema>;

/**
 * Schema for remove faulty addresses result
 */
export const RemoveFaultyAddressesResultSchema = z.object({
  success: z.boolean(),
  dry_run: z.boolean(),
  total_rows_deleted: z.number(),
  tables_affected: z.array(z.string()),
  removals: z
    .array(
      z.object({
        mint: z.string(),
        table_name: z.string(),
        rows_deleted: z.number(),
        error: z.string().nullable().optional(),
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type RemoveFaultyAddressesResult = z.infer<typeof RemoveFaultyAddressesResultSchema>;

/**
 * Schema for move invalid tokens result
 */
export const MoveInvalidTokensResultSchema = z.object({
  success: z.boolean(),
  dry_run: z.boolean(),
  total_calls_moved: z.number(),
  total_links_moved: z.number(),
  total_callers_affected: z.number(),
  moves: z
    .array(
      z.object({
        mint: z.string(),
        calls_moved: z.number(),
        links_moved: z.number(),
        callers_affected: z.array(z.string()),
        error: z.string().nullable().optional(),
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

export type MoveInvalidTokensResult = z.infer<typeof MoveInvalidTokensResultSchema>;

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
    callerName?: string,
    fromTsMs?: number,
    toTsMs?: number
  ): Promise<CallsQueryResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_calls',
        data: {
          limit: limit || 1000, // Default limit
          exclude_unrecoverable: excludeUnrecoverable !== false, // Default to true
          caller_name: callerName || undefined, // Pass caller_name if provided
          from_ts_ms: fromTsMs || undefined, // Pass from_ts_ms if provided
          to_ts_ms: toTsMs || undefined, // Pass to_ts_ms if provided
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
    tokenAddress: string,
    chain: string,
    interval: string,
    reason: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'add_ohlcv_exclusion',
        data: {
          token_address: tokenAddress,
          chain,
          interval,
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
   * Matches ClickHouse ohlcv_candles structure: token_address, chain, interval
   */
  async queryOhlcvExclusions(
    duckdbPath: string,
    options?: {
      tokenAddresses?: string[];
      chains?: string[];
      intervals?: string[];
    }
  ): Promise<OhlcvExclusionResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_ohlcv_exclusions',
        data: {
          token_addresses: options?.tokenAddresses,
          chains: options?.chains,
          intervals: options?.intervals,
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

  /**
   * Query recent tokens from DuckDB (< maxAgeDays old)
   * Returns unique tokens with their earliest call timestamp
   */
  async queryTokensRecent(duckdbPath: string, maxAgeDays?: number): Promise<TokensQueryResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'query_tokens_recent',
        data: {
          max_age_days: maxAgeDays || 90,
        },
      });

      return TokensQueryResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to query recent tokens from DuckDB', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate all addresses in DuckDB database
   * Checks for truncated addresses, invalid formats, etc.
   */
  async validateAddresses(duckdbPath: string): Promise<ValidateAddressesResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'validate_addresses',
        data: {},
      });

      return ValidateAddressesResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to validate addresses in DuckDB', error as Error);
      return {
        success: false,
        total_addresses: 0,
        valid_addresses: 0,
        faulty_addresses: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Remove faulty addresses from DuckDB database
   * Deletes rows containing invalid/truncated addresses
   */
  async removeFaultyAddresses(
    duckdbPath: string,
    dryRun: boolean = false
  ): Promise<RemoveFaultyAddressesResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'remove_faulty_addresses',
        data: {
          dry_run: dryRun,
        },
      });

      return RemoveFaultyAddressesResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to remove faulty addresses from DuckDB', error as Error);
      return {
        success: false,
        dry_run: dryRun,
        total_rows_deleted: 0,
        tables_affected: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Move invalid tokens to separate table and update caller statistics
   * Moves calls from user_calls_d and caller_links_d to invalid_tokens_d
   */
  async moveInvalidTokens(
    duckdbPath: string,
    mints: string[],
    dryRun: boolean = false
  ): Promise<MoveInvalidTokensResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'move_invalid_tokens',
        data: {
          mints,
          dry_run: dryRun,
        },
      });

      return MoveInvalidTokensResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to move invalid tokens in DuckDB', error as Error);
      return {
        success: false,
        dry_run: dryRun,
        total_calls_moved: 0,
        total_links_moved: 0,
        total_callers_affected: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Store token creation info from Birdeye API
   * Stores creation data (txHash, slot, decimals, owner, creation time) for Solana tokens
   */
  async storeTokenCreationInfo(
    duckdbPath: string,
    tokens: Array<{
      token_address: string;
      tx_hash: string;
      slot: number;
      decimals: number;
      owner: string;
      block_unix_time: number;
      block_human_time: string;
    }>
  ): Promise<TokenCreationInfoStorageResult> {
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath,
        operation: 'store_token_creation_info',
        data: {
          tokens,
        },
      });

      return TokenCreationInfoStorageResultSchema.parse(result);
    } catch (error) {
      logger.error('Failed to store token creation info in DuckDB', error as Error);
      return {
        success: false,
        stored_count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
