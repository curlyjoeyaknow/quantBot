/**
 * Handler for simulation store-strategy command
 *
 * Stores a strategy in DuckDB using DuckDBStorageService.
 */

import type { CommandContext } from '../../core/command-context.js';
import { storeStrategySchema, type StoreStrategyArgs } from '../../command-defs/simulation.js';

export async function storeStrategyDuckdbHandler(args: StoreStrategyArgs, ctx: CommandContext) {
  const service = ctx.services.duckdbStorage();

  return await service.storeStrategy(
    args.duckdb,
    args.strategyId,
    args.name,
    args.entryConfig,
    args.exitConfig,
    args.reentryConfig,
    args.costConfig
  );
}
