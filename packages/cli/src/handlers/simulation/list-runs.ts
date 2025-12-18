import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { ListRunsArgs } from '../../command-defs/simulation.js';

export async function listRunsHandler(args: ListRunsArgs, ctx: CommandContext): Promise<unknown[]> {
  const runsRepo = ctx.services.simulationRunsRepository();
  const callersRepo = ctx.services.callersRepository();

  // Build filters
  const filters: {
    callerId?: number;
    limit?: number;
    offset?: number;
  } = {
    limit: args.limit,
  };

  // Resolve caller name to ID if provided
  // Try 'telegram' source first (most common), then try 'solana' as fallback
  if (args.caller) {
    let caller = await callersRepo.findByName('telegram', args.caller);
    if (!caller) {
      caller = await callersRepo.findByName('solana', args.caller);
    }
    if (caller) {
      filters.callerId = caller.id;
    } else {
      // Caller not found, return empty
      return [];
    }
  }

  // Note: SimulationRunsRepository.listRuns doesn't support date filtering yet
  // We'll filter in memory for now
  const runs = await runsRepo.listRuns(filters);

  // Filter by date range if provided
  let filteredRuns = runs;
  if (args.from || args.to) {
    filteredRuns = runs.filter((run) => {
      if (!run.createdAt) return false;
      const createdAt = run.createdAt;
      if (args.from) {
        const fromDate = DateTime.fromISO(args.from, { zone: 'utc' });
        if (createdAt < fromDate) return false;
      }
      if (args.to) {
        const toDate = DateTime.fromISO(args.to, { zone: 'utc' });
        if (createdAt > toDate) return false;
      }
      return true;
    });
  }

  return filteredRuns;
}
