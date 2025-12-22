/**
 * CLI Composition Root for DuckDB Simulation
 *
 * This is a composition root - it wires adapters and calls the pure handler.
 * All I/O, env reads, and adapter wiring happens here.
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  runSimulationDuckdbSchema,
  type RunSimulationDuckdbArgs,
} from '../../command-defs/simulation.js';
import {
  createDuckdbSimulationContext,
  type RunSimulationDuckdbContext,
} from '@quantbot/workflows';
import { runSimulationDuckdbHandler as pureHandler } from '../../pure/simulation/run-simulation-duckdb.js';
import type { RunSimulationDuckdbHandlerArgs } from '../../pure/simulation/run-simulation-duckdb.js';
import process from 'node:process';

// Re-export schema for convenience
export { runSimulationDuckdbSchema };
export type { RunSimulationDuckdbArgs };

/**
 * CLI composition root for DuckDB simulation
 *
 * This function can:
 * - Read process.env ✅
 * - Wire adapters ✅
 * - Do I/O ✅
 *
 * It wires the workflow context and calls the pure handler.
 */
export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbArgs,
  ctx: CommandContext
) {
  // ENV + ADAPTER WIRING LIVE HERE (composition root)
  // Create workflow context with services from CommandContext
  // Note: ohlcvFetchJob removed - workflow now uses ports directly
  const workflowContext = await createDuckdbSimulationContext({
    simulationService: ctx.services.simulation(),
    duckdbStorageService: ctx.services.duckdbStorage(),
    ohlcvIngestionService: ctx.services.ohlcvIngestion(),
  });

  // Convert args to handler args format
  const handlerArgs: RunSimulationDuckdbHandlerArgs = {
    duckdb: args.duckdb,
    strategy: typeof args.strategy === 'string' ? args.strategy : args.strategy.name,
    initial_capital: args.initial_capital,
    lookback_minutes: args.lookback_minutes,
    lookforward_minutes: args.lookforward_minutes,
    resume: args.resume,
    batch: args.batch ? 1 : undefined, // Convert boolean to number or undefined
    mint: args.mint,
    alert_timestamp: args.alert_timestamp,
  };

  // Store workflow context in command context for the handler
  // This is a temporary measure until we refactor CommandContext to support workflow contexts
  // Use type assertion since we're extending the context with workflowContext
  const ctxWithWorkflow = ctx as CommandContext & {
    services: CommandContext['services'] & {
      workflowContext: () => RunSimulationDuckdbContext;
    };
  };
  // Add workflowContext to services
  (
    ctxWithWorkflow.services as typeof ctxWithWorkflow.services & {
      workflowContext: () => RunSimulationDuckdbContext;
    }
  ).workflowContext = () => workflowContext;

  // Call pure handler (no I/O, no env, no time globals)
  return await pureHandler(handlerArgs, ctxWithWorkflow);
}
