/**
 * Handler for simulation store-strategy command
 *
 * Stores a strategy in DuckDB using Python service.
 */

import type { CommandContext } from '../../core/command-context.js';
import { storeStrategySchema, type StoreStrategyArgs } from '../../command-defs/simulation.js';

export async function storeStrategyDuckdbHandler(
  args: StoreStrategyArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const engine = ctx.services.pythonEngine();

  return await engine.runDuckDBStorage({
    duckdbPath: args.duckdb,
    operation: 'store_strategy',
    data: {
      strategy_id: args.strategyId,
      name: args.name,
      entry_config: args.entryConfig,
      exit_config: args.exitConfig,
      reentry_config: args.reentryConfig,
      cost_config: args.costConfig,
    },
  });
}

