/**
 * Handler for simulation store-run command
 *
 * Stores a simulation run in DuckDB using Python service.
 */

import type { CommandContext } from '../../core/command-context.js';
import { storeRunSchema, type StoreRunArgs } from '../../command-defs/simulation.js';

export async function storeRunDuckdbHandler(
  args: StoreRunArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const engine = ctx.services.pythonEngine();

  return await engine.runDuckDBStorage({
    duckdbPath: args.duckdb,
    operation: 'store_run',
    data: {
      run_id: args.runId,
      strategy_id: args.strategyId,
      mint: args.mint,
      alert_timestamp: args.alertTimestamp,
      start_time: args.startTime,
      end_time: args.endTime,
      initial_capital: args.initialCapital,
      final_capital: args.finalCapital,
      total_return_pct: args.totalReturnPct,
      max_drawdown_pct: args.maxDrawdownPct,
      sharpe_ratio: args.sharpeRatio,
      win_rate: args.winRate,
      total_trades: args.totalTrades,
    },
  });
}

