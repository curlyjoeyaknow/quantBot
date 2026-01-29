/**
 * Backtest Results Port
 *
 * Provides access to backtest run results and metrics.
 * Handlers depend on this port, not on specific implementations (DuckDB, Parquet, etc.).
 */

/**
 * Run summary metrics
 */
export interface RunSummary {
  runId: string;
  totalTrades: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  avgReturnBps: number;
  winRate: number;
  maxDrawdownBps: number;
  medianDrawdownBps: number | null;
  totalCalls: number;
  uniqueCallers: number;
  createdAt: string | null;
}

/**
 * Caller path metrics row
 */
export interface CallerPathRow {
  caller_name: string;
  calls: number;
  count_2x: number;
  count_3x: number;
  count_4x: number;
  failures_2x: number;
  p_hit_2x: number;
  p_hit_3x: number;
  p_hit_4x: number;
  median_t2x_min: number | null;
  median_t3x_min: number | null;
  median_t4x_min: number | null;
  avg_dd_bps: number | null;
  avg_dd_to_2x_bps: number | null;
  median_alert_to_activity_s: number | null;
  avg_peak_multiple: number | null;
}

/**
 * Trade result row
 */
export interface TradeResultRow {
  run_id: string;
  call_id: string;
  caller_name: string;
  pnl_usd: number;
  return_bps: number;
  dd_bps: number | null;
  hit_2x: boolean;
  hit_3x: boolean;
  hit_4x: boolean;
  created_at: string;
  [key: string]: unknown;
}

/**
 * Query filter for run summaries
 */
export interface RunSummaryQuery {
  runId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

/**
 * Export format options
 */
export type ExportFormat = 'csv' | 'json' | 'parquet';

/**
 * Export options
 */
export interface ExportOptions {
  format: ExportFormat;
  includeTrades?: boolean;
  includeMetrics?: boolean;
}

/**
 * Backtest Results Port Interface
 *
 * Handlers depend on this port, not on specific implementations (DuckDB, Parquet, etc.).
 * Adapters implement this port.
 */
export interface BacktestResultsPort {
  /**
   * Get run summary for a specific run
   *
   * @param runId - Run ID
   * @returns Run summary or null if not found
   */
  getRunSummary(runId: string): Promise<RunSummary | null>;

  /**
   * Get caller path report for a run
   *
   * @param runId - Run ID
   * @returns Array of caller path metrics
   */
  getCallerPathReport(runId: string): Promise<CallerPathRow[]>;

  /**
   * Get trade results for a run
   *
   * @param runId - Run ID
   * @returns Array of trade results
   */
  getTradeResults(runId: string): Promise<TradeResultRow[]>;

  /**
   * List all run summaries
   *
   * @param query - Query filter
   * @returns Array of run summaries
   */
  listRunSummaries(query?: RunSummaryQuery): Promise<RunSummary[]>;

  /**
   * Export run results to a file
   *
   * @param runId - Run ID
   * @param outputPath - Output file path
   * @param options - Export options
   * @returns Export result with file path and record count
   */
  exportResults(
    runId: string,
    outputPath: string,
    options: ExportOptions
  ): Promise<{ outputPath: string; recordsExported: number }>;

  /**
   * Check if port is available
   *
   * @returns true if results storage is available and ready
   */
  isAvailable(): Promise<boolean>;
}
