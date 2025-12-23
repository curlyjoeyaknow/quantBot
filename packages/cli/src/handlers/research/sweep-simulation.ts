/**
 * Sweep Research Simulation Handler
 */

import { readFile } from 'fs/promises';
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { researchSweepSchema } from '../../command-defs/research.js';
import { runParameterSweep, createExperimentContext } from '@quantbot/workflows';
import type { ParameterSweepRequest } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';

export type SweepSimulationArgs = z.infer<typeof researchSweepSchema>;

/**
 * Run parameter sweep from a sweep JSON file
 */
export async function sweepSimulationHandler(args: SweepSimulationArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  // Read sweep file
  const sweepContent = await readFile(args.sweepFile, 'utf-8');
  const sweepRequest: ParameterSweepRequest = JSON.parse(sweepContent);

  logger.info(`[research.sweep] Starting parameter sweep from ${args.sweepFile}`);

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Run parameter sweep
  const result = await runParameterSweep(sweepRequest, experimentCtx);

  logger.info(`[research.sweep] Completed parameter sweep with ${result.runIds.length} runs`);

  return result;
}
