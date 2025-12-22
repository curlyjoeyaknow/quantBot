/**
 * Pure Handler for run-simulation-duckdb command
 *
 * This is a pure use-case function:
 * - No Commander.js
 * - No console.log / console.error
 * - No process.exit
 * - No environment variable reads
 * - No output formatting
 * - Pure orchestration: get workflow from context, call workflow, return result
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  runSimulationDuckdb,
  type RunSimulationDuckdbSpec,
  type RunSimulationDuckdbContext,
} from '@quantbot/workflows';

export type RunSimulationDuckdbHandlerArgs = {
  duckdb: string;
  strategy: string;
  initial_capital?: number;
  lookback_minutes?: number;
  lookforward_minutes?: number;
  resume?: boolean;
  batch?: number;
  mint?: string;
  alert_timestamp?: string;
};

export type RunSimulationDuckdbHandlerResult = {
  simulationResults: unknown[]; // Workflow returns structured results
};

/**
 * Pure handler for DuckDB simulation
 *
 * Takes validated args and context, calls workflow, returns result.
 * All I/O, env reads, and adapter wiring happens in the command composition root.
 */
export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbHandlerArgs,
  ctx: CommandContext
): Promise<RunSimulationDuckdbHandlerResult> {
  // Build spec from args (pure transformation)
  const spec: RunSimulationDuckdbSpec = {
    duckdbPath: args.duckdb,
    strategy: args.strategy,
    initialCapital: args.initial_capital,
    lookbackMinutes: args.lookback_minutes,
    lookforwardMinutes: args.lookforward_minutes,
    resume: args.resume,
    batch: args.batch,
    mint: args.mint,
    alertTimestamp: args.alert_timestamp,
    errorMode: 'collect', // Collect errors, don't fail fast
    maxRetries: 1,
    callsLimit: 1000,
  };

  // Get workflow context from command context
  // The context should already be wired with adapters by the composition root
  const workflowContext = ctx.services.workflowContext?.() as RunSimulationDuckdbContext | undefined;

  if (!workflowContext) {
    throw new Error(
      'WorkflowContext not available. This handler requires a wired WorkflowContext from the composition root.'
    );
  }

  // Call workflow (orchestration happens here)
  const result = await runSimulationDuckdb(spec, workflowContext);

  // Return result (already JSON-serializable from workflow)
  return {
    simulationResults: result.simulationResults,
  };
}

