import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { ListRunsArgs } from '../../command-defs/simulation.js';

export async function listRunsHandler(args: ListRunsArgs, ctx: CommandContext): Promise<unknown[]> {
  // TODO: Implement DuckDB-based simulation runs listing
  // PostgreSQL SimulationRunsRepository was removed - need to implement DuckDB equivalent
  // For now, return empty array
  return [];
  
  // const callersRepo = ctx.services.callersRepository();

  // TODO: Re-implement using DuckDB when simulation runs storage is available
  // Previous implementation used PostgreSQL SimulationRunsRepository which was removed
}
