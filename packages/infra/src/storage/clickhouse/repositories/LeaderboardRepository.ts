/**
 * LeaderboardRepository
 *
 * ClickHouse repository for strategy leaderboard.
 *
 * Stores simulation results for ranking and comparison.
 */

import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '../../../utils/index.js';

// Optional lab types - use any if lab package not available
type SimulationMetrics = {
  totalPnl: number;
  totalPnlPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio?: number | null;
  totalTrades: number;
  winRate: number;
  totalExposureTime?: number;
  avgHoldTime?: number;
};

type StabilityScore = {
  score: number;
  volatility?: number;
  consistency?: number;
};

export interface LeaderboardEntry {
  strategyId: string;
  featureSetId: string;
  configHash: string;
  windowId?: string;
  presetName: string;
  runId: string;
  metrics: SimulationMetrics;
  stabilityScore?: StabilityScore;
}

import type { LeaderboardPort } from '../../ports/LeaderboardPort.js';
import type { SimSummaryV1 } from '../../ports/SimulationPort.js';
import type { RunContext } from '../../ports/CandleSlicePort.js';

/**
 * LeaderboardRepository
 */
export class LeaderboardRepository implements LeaderboardPort {
  /**
   * Ingest simulation summary (implements LeaderboardPort)
   */
  async ingest(args: { run: RunContext; summary: SimSummaryV1 }): Promise<void> {
    await this.insertEntry({
      strategyId: args.summary.configHash, // Use configHash as strategy ID
      featureSetId: args.summary.featureSetId,
      configHash: args.summary.configHash,
      windowId: args.summary.windowId,
      presetName: args.summary.presetName,
      runId: args.run.runId,
      metrics: {
        totalPnl: args.summary.pnlQuote,
        totalPnlPercent: 0, // Calculate if needed
        maxDrawdown: args.summary.maxDrawdownQuote,
        maxDrawdownPercent: 0, // Calculate if needed
        totalTrades: args.summary.trades,
        winRate: args.summary.winRate,
      },
    });
  }

  /**
   * Insert leaderboard entry
   */
  async insertEntry(entry: LeaderboardEntry): Promise<void> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    const row = {
      strategy_id: entry.strategyId,
      feature_set_id: entry.featureSetId,
      config_hash: entry.configHash,
      window_id: entry.windowId || '',
      preset_name: entry.presetName,
      run_id: entry.runId,
      pnl: entry.metrics.totalPnl,
      pnl_percent: entry.metrics.totalPnlPercent,
      drawdown: entry.metrics.maxDrawdown,
      drawdown_percent: entry.metrics.maxDrawdownPercent,
      sharpe: entry.metrics.sharpeRatio ?? null,
      stability_score: entry.stabilityScore?.score ?? null,
      total_trades: entry.metrics.totalTrades,
      win_rate: entry.metrics.winRate,
      total_exposure_time: entry.metrics.totalExposureTime,
      avg_hold_time: entry.metrics.avgHoldTime,
    };

    try {
      await ch.insert({
        table: `${CLICKHOUSE_DATABASE}.strategy_leaderboard`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Inserted leaderboard entry', {
        strategyId: entry.strategyId,
        presetName: entry.presetName,
        pnlPercent: entry.metrics.totalPnlPercent,
      });
    } catch (error: unknown) {
      logger.error('Failed to insert leaderboard entry', error as Error, {
        strategyId: entry.strategyId,
      });
      throw error;
    }
  }

  /**
   * Get top strategies by PnL
   */
  async getTopByPnl(limit: number = 10): Promise<LeaderboardEntry[]> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    try {
      const result = await ch.query({
        query: `
          SELECT
            strategy_id,
            feature_set_id,
            config_hash,
            preset_name,
            max_pnl_percent,
            avg_pnl_percent,
            run_count
          FROM ${CLICKHOUSE_DATABASE}.mv_leaderboard_top_pnl
          ORDER BY max_pnl_percent DESC
          LIMIT ${limit}
        `,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{
        strategy_id: string;
        feature_set_id: string;
        config_hash: string;
        preset_name: string;
        max_pnl_percent: number;
        avg_pnl_percent: number;
        run_count: number;
      }>;

      // Convert to LeaderboardEntry format (simplified)
      return data.map((row) => ({
        strategyId: row.strategy_id,
        featureSetId: row.feature_set_id,
        configHash: row.config_hash,
        presetName: row.preset_name,
        runId: '', // Not available in aggregated view
        metrics: {
          totalPnlPercent: row.max_pnl_percent,
        } as SimulationMetrics,
      }));
    } catch (error: unknown) {
      logger.error('Failed to query top by PnL', error as Error);
      return [];
    }
  }

  /**
   * Get top strategies by stability
   */
  async getTopByStability(limit: number = 10): Promise<LeaderboardEntry[]> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    try {
      const result = await ch.query({
        query: `
          SELECT
            strategy_id,
            feature_set_id,
            config_hash,
            preset_name,
            max_stability,
            avg_stability,
            avg_pnl_percent,
            run_count
          FROM ${CLICKHOUSE_DATABASE}.mv_leaderboard_top_stability
          ORDER BY max_stability DESC
          LIMIT ${limit}
        `,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{
        strategy_id: string;
        feature_set_id: string;
        config_hash: string;
        preset_name: string;
        max_stability: number;
        avg_stability: number;
        avg_pnl_percent: number;
        run_count: number;
      }>;

      return data.map((row) => ({
        strategyId: row.strategy_id,
        featureSetId: row.feature_set_id,
        configHash: row.config_hash,
        presetName: row.preset_name,
        runId: '',
        metrics: {
          totalPnlPercent: row.avg_pnl_percent,
        } as SimulationMetrics,
        stabilityScore: {
          score: row.max_stability,
        } as StabilityScore,
      }));
    } catch (error: unknown) {
      logger.error('Failed to query top by stability', error as Error);
      return [];
    }
  }

  /**
   * Get Pareto frontier (best PnL for each stability level)
   */
  async getParetoFrontier(): Promise<LeaderboardEntry[]> {
    const ch = getClickHouseClient();
    const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

    try {
      const result = await ch.query({
        query: `
          SELECT
            stability_bucket,
            strategy_id,
            feature_set_id,
            config_hash,
            preset_name,
            max_pnl_percent,
            avg_stability
          FROM ${CLICKHOUSE_DATABASE}.mv_leaderboard_pareto
          ORDER BY stability_bucket DESC, max_pnl_percent DESC
        `,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{
        stability_bucket: number;
        strategy_id: string;
        feature_set_id: string;
        config_hash: string;
        preset_name: string;
        max_pnl_percent: number;
        avg_stability: number;
      }>;

      return data.map((row) => ({
        strategyId: row.strategy_id,
        featureSetId: row.feature_set_id,
        configHash: row.config_hash,
        presetName: row.preset_name,
        runId: '',
        metrics: {
          totalPnlPercent: row.max_pnl_percent,
        } as SimulationMetrics,
        stabilityScore: {
          score: row.avg_stability,
        } as StabilityScore,
      }));
    } catch (error: unknown) {
      logger.error('Failed to query Pareto frontier', error as Error);
      return [];
    }
  }
}
