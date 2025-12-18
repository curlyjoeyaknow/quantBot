/**
 * Handler for running DuckDB-based simulations.
 * Uses SimulationService to run simulations.
 */

import type { CommandContext } from '../../core/command-context.js';
import { ValidationError } from '@quantbot/utils';
import {
  runSimulationDuckdbSchema,
  type RunSimulationDuckdbArgs,
} from '../../command-defs/simulation.js';
import type { SimulationConfig } from '@quantbot/simulation';

// Re-export schema for convenience
export { runSimulationDuckdbSchema };
export type { RunSimulationDuckdbArgs };

export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbArgs,
  ctx: CommandContext
) {
  const service = ctx.services.simulation();

  // Build config
  const config: SimulationConfig = {
    duckdb_path: args.duckdb,
    strategy: args.strategy,
    initial_capital: args.initial_capital,
    lookback_minutes: args.lookback_minutes,
    lookforward_minutes: args.lookforward_minutes,
  };

  if (args.batch) {
    config.batch = true;

    // Query DuckDB for calls to simulate
    const duckdbService = ctx.services.duckdbStorage();
    const callsResult = await duckdbService.queryCalls(args.duckdb, 1000); // Default limit: 1000 calls

    if (!callsResult.success || !callsResult.calls || callsResult.calls.length === 0) {
      throw new ValidationError(
        callsResult.error || 'No calls found in DuckDB for batch simulation',
        {
          operation: 'run_simulation_duckdb',
          mode: 'batch',
          duckdbPath: args.duckdb,
        }
      );
    }

    // Extract mints and alert timestamps
    config.mints = callsResult.calls.map(
      (call: { mint: string; alert_timestamp: string }) => call.mint
    );
    config.alert_timestamps = callsResult.calls.map(
      (call: { mint: string; alert_timestamp: string }) => call.alert_timestamp
    );
  } else {
    if (!args.mint) {
      throw new ValidationError('mint is required for single simulation', {
        operation: 'run_simulation_duckdb',
        mode: 'single',
      });
    }
    config.mint = args.mint;
    config.alert_timestamp = args.alert_timestamp || new Date().toISOString();
  }

  return await service.runSimulation(config);
}
