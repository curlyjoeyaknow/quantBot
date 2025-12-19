/**
 * Handler for simulation store-run command
 *
 * Stores a simulation run in DuckDB using DuckDBStorageService.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { StoreRunArgs } from '../../command-defs/simulation.js';
import { ValidationError } from '@quantbot/utils';

export async function storeRunDuckdbHandler(args: StoreRunArgs, ctx: CommandContext) {
  const service = ctx.services.duckdbStorage();

  // storeRun requires strategyName and strategyConfig which are not in the schema
  // For now, use strategyId as strategyName and provide minimal config
  // TODO: Update schema to include strategyName and strategyConfig
  const strategyName = args.strategyId; // Use strategyId as fallback
  const strategyConfig = {
    entry: {},
    exit: {},
  };

  return await service.storeRun(
    args.duckdb,
    args.runId,
    args.strategyId,
    strategyName,
    args.mint,
    args.alertTimestamp,
    args.startTime,
    args.endTime,
    args.initialCapital,
    strategyConfig,
    undefined, // callerName
    args.finalCapital,
    args.totalReturnPct,
    args.maxDrawdownPct,
    args.sharpeRatio,
    args.winRate,
    args.totalTrades
  );
}
