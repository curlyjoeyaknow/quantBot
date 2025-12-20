/**
 * Handler for running DuckDB-based simulations.
 *
 * Thin adapter: parses args, calls workflow, returns data.
 * NO orchestration logic - that belongs in the workflow.
 *
 * Flow:
 * 1. Parse args → build spec
 * 2. Create workflow context
 * 3. Call workflow
 * 4. Return result (workflow returns JSON-serializable data)
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  runSimulationDuckdbSchema,
  type RunSimulationDuckdbArgs,
} from '../../command-defs/simulation.js';
import {
  runSimulationDuckdb,
  createDuckdbSimulationContext,
  type RunSimulationDuckdbSpec,
} from '@quantbot/workflows';

// Re-export schema for convenience
export { runSimulationDuckdbSchema };
export type { RunSimulationDuckdbArgs };

/**
 * Handler function: thin adapter (parse → call workflow → return)
 *
 * Follows workflow contract:
 * - Parse args → spec
 * - Create context
 * - Call workflow
 * - Return structured result (already JSON-serializable from workflow)
 */
export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbArgs,
  ctx: CommandContext
) {
  // Parse args → build spec
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

  // Create OhlcvBirdeyeFetch service for OHLCV ingestion context
  // Dynamic import to avoid build-time dependency on @quantbot/jobs
  const { OhlcvBirdeyeFetch } = await import('@quantbot/jobs');
  const ohlcvBirdeyeFetch = new OhlcvBirdeyeFetch();

  // Create workflow context with services from CommandContext
  const workflowContext = createDuckdbSimulationContext({
    simulationService: ctx.services.simulation(),
    duckdbStorageService: ctx.services.duckdbStorage(),
    ohlcvIngestionService: ctx.services.ohlcvIngestion(),
    ohlcvBirdeyeFetch, // Required for OHLCV ingestion context
  });

  // Call workflow (orchestration happens here)
  const result = await runSimulationDuckdb(spec, workflowContext);

  // Return result (already JSON-serializable from workflow)
  // Extract simulationResults for backward compatibility
  return result.simulationResults;
}
