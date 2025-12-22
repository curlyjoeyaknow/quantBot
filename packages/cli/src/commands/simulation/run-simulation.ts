import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { type RunSimulationArgs } from '../../command-defs/simulation.js';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import type { SimulationRunSpec } from '@quantbot/workflows';

export async function runSimulationHandler(args: RunSimulationArgs, _ctx: CommandContext) {
  // Build workflow spec
  const spec: SimulationRunSpec = {
    strategyName: args.strategy,
    callerName: args.caller,
    from: DateTime.fromISO(args.from, { zone: 'utc' }),
    to: DateTime.fromISO(args.to, { zone: 'utc' }),
    options: {
      preWindowMinutes: args.preWindow,
      postWindowMinutes: args.postWindow,
      dryRun: args.dryRun,
    },
  };

  // Create production context
  const ctx = createProductionContext();

  // Run workflow
  return await runSimulation(spec, ctx);
}
