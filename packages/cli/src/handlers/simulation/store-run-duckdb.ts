/**
 * Handler for simulation store-run command
 *
 * Stores a simulation run in DuckDB using DuckDBStorageService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { storeRunSchema, type StoreRunArgs } from '../../command-defs/simulation.js';

export async function storeRunDuckdbHandler(args: StoreRunArgs, ctx: CommandContext) {
  const service = ctx.services.duckdbStorage();

  return await service.storeRun(
    args.duckdb,
    args.runId,
    args.strategyId,
    args.mint,
    args.alertTimestamp,
    args.startTime,
    args.endTime,
    args.initialCapital,
    args.finalCapital,
    args.totalReturnPct,
    args.maxDrawdownPct,
    args.sharpeRatio,
    args.winRate,
    args.totalTrades
  );
}
