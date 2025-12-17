/**
 * Handler for running DuckDB-based simulations.
 * Calls Python simulation script and returns results.
 */

import type { CommandContext } from '../../core/command-context.js';
import { execa } from 'execa';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '@quantbot/utils';
import { runSimulationDuckdbSchema, type RunSimulationDuckdbArgs } from '../../command-defs/simulation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Re-export schema for convenience
export { runSimulationDuckdbSchema };
export type { RunSimulationDuckdbArgs };

export async function runSimulationDuckdbHandler(
  args: RunSimulationDuckdbArgs,
  ctx: CommandContext
) {
  const pythonScript = path.resolve(
    __dirname,
    '../../../../../tools/telegram/simulation/run_simulation.py'
  );

  // Build config JSON
  const config: Record<string, unknown> = {
    duckdb_path: args.duckdb,
    strategy: args.strategy,
    initial_capital: args.initial_capital,
    lookback_minutes: args.lookback_minutes,
    lookforward_minutes: args.lookforward_minutes,
  };

  if (args.batch) {
    config.batch = true;
    // In batch mode, we'd need to fetch mints and timestamps from DB
    // For now, this is a placeholder
    logger.warn('Batch mode requires fetching calls from database - not yet implemented');
  } else {
    if (!args.mint) {
      throw new Error('mint is required for single simulation');
    }
    config.mint = args.mint;
    config.alert_timestamp = args.alert_timestamp || new Date().toISOString();
  }

  try {
    const { stdout, stderr } = await execa('python3', [pythonScript], {
      input: JSON.stringify(config),
      encoding: 'utf8',
      timeout: 300000, // 5 minute timeout
    });

    if (stderr) {
      logger.warn('Python simulation stderr:', stderr);
    }

    // Parse JSON output
    const result = JSON.parse(stdout);
    return result;
  } catch (error) {
    logger.error('Simulation failed:', error);
    throw new Error(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
