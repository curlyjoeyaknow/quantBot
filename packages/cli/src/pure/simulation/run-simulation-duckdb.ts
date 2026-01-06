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

import { ValidationError, ConfigurationError } from '@quantbot/utils';
import type { CommandContext } from '../../core/command-context.js';
import {
  runSimulationDuckdb,
  type RunSimulationDuckdbSpec,
  type RunSimulationDuckdbContext,
} from '@quantbot/workflows';
import type { SimulationOutput } from '@quantbot/backtest';

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

export type RunSimulationDuckdbHandlerResult = SimulationOutput;

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
  // Parse strategy from JSON string to object
  let strategyConfig: Record<string, unknown>;
  try {
    strategyConfig = JSON.parse(args.strategy) as Record<string, unknown>;
  } catch (error) {
    throw new ValidationError('Invalid strategy JSON', {
      strategy: args.strategy,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Build spec from args (pure transformation)
  const spec: RunSimulationDuckdbSpec = {
    duckdbPath: args.duckdb,
    strategy: strategyConfig,
    initialCapital: args.initial_capital,
    lookbackMinutes: args.lookback_minutes,
    lookforwardMinutes: args.lookforward_minutes,
    resume: args.resume ?? false,
    batch: typeof args.batch === 'number' ? args.batch > 0 : false,
    mint: args.mint,
    alertTimestamp: args.alert_timestamp,
    errorMode: 'collect', // Collect errors, don't fail fast
    maxRetries: 1,
    callsLimit: 1000,
  };

  // Get workflow context from command context (created by composition root)
  // The command composition root creates and wires the workflow context
  const workflowContext = (
    ctx as CommandContext & {
      services: CommandContext['services'] & {
        workflowContext?: () => RunSimulationDuckdbContext;
      };
    }
  ).services.workflowContext?.();

  if (!workflowContext) {
    throw new ConfigurationError(
      'WorkflowContext not available. This handler requires a wired WorkflowContext from the composition root.',
      'WorkflowContext',
      { operation: 'runSimulationDuckdbHandler' }
    );
  }

  // Call workflow (orchestration happens here)
  const result = await runSimulationDuckdb(spec, workflowContext);

  // Return simulationResults directly (it has results and summary properties)
  return result.simulationResults;
}
