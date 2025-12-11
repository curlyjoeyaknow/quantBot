/**
 * SimulationResultsRepository - Postgres repository for simulation results summary
 * 
 * Handles all database operations for simulation_results_summary table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool } from '../postgres-client';
import { logger } from '@quantbot/utils';

export interface SimulationSummaryInsertData {
  simulationRunId: number;
  finalPnl: number;
  maxDrawdown?: number;
  volatility?: number;
  sharpeRatio?: number;
  sortinoRatio?: number;
  winRate?: number;
  tradeCount?: number;
  avgTradeReturn?: number;
  medianTradeReturn?: number;
  reentryCount?: number;
  ladderEntriesUsed?: number;
  ladderExitsUsed?: number;
  averageHoldingMinutes?: number;
  maxHoldingMinutes?: number;
  metadata?: Record<string, unknown>;
}

export class SimulationResultsRepository {
  /**
   * Upsert simulation results summary
   */
  async upsertSummary(data: SimulationSummaryInsertData): Promise<void> {
    await getPostgresPool().query(
      `INSERT INTO simulation_results_summary (
        simulation_run_id, final_pnl, max_drawdown, volatility,
        sharpe_ratio, sortino_ratio, win_rate, trade_count,
        avg_trade_return, median_trade_return, reentry_count,
        ladder_entries_used, ladder_exits_used,
        average_holding_minutes, max_holding_minutes, metadata_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (simulation_run_id) DO UPDATE SET
        final_pnl = EXCLUDED.final_pnl,
        max_drawdown = EXCLUDED.max_drawdown,
        volatility = EXCLUDED.volatility,
        sharpe_ratio = EXCLUDED.sharpe_ratio,
        sortino_ratio = EXCLUDED.sortino_ratio,
        win_rate = EXCLUDED.win_rate,
        trade_count = EXCLUDED.trade_count,
        avg_trade_return = EXCLUDED.avg_trade_return,
        median_trade_return = EXCLUDED.median_trade_return,
        reentry_count = EXCLUDED.reentry_count,
        ladder_entries_used = EXCLUDED.ladder_entries_used,
        ladder_exits_used = EXCLUDED.ladder_exits_used,
        average_holding_minutes = EXCLUDED.average_holding_minutes,
        max_holding_minutes = EXCLUDED.max_holding_minutes,
        metadata_json = EXCLUDED.metadata_json`,
      [
        data.simulationRunId,
        data.finalPnl,
        data.maxDrawdown || null,
        data.volatility || null,
        data.sharpeRatio || null,
        data.sortinoRatio || null,
        data.winRate || null,
        data.tradeCount || null,
        data.avgTradeReturn || null,
        data.medianTradeReturn || null,
        data.reentryCount || null,
        data.ladderEntriesUsed || null,
        data.ladderExitsUsed || null,
        data.averageHoldingMinutes || null,
        data.maxHoldingMinutes || null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );

    logger.debug('Upserted simulation results summary', { runId: data.simulationRunId });
  }
}

