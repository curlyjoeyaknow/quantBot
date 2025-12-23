/**
 * Run Research Simulation Handler
 */

import { readFile } from 'fs/promises';
import type { z } from 'zod';
import { researchRunSchema } from '../../command-defs/research.js';
import type { CommandContext } from '../../core/command-context.js';
import { runSingleSimulation, createExperimentContext } from '@quantbot/workflows';
import type { SimulationRequest } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';

export type RunSimulationArgs = z.infer<typeof researchRunSchema>;

/**
 * Run a single simulation from a request JSON file
 */
export async function runSimulationHandler(args: RunSimulationArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  // Read request file
  const requestContent = await readFile(args.requestFile, 'utf-8');
  const request: SimulationRequest = JSON.parse(requestContent);

  logger.info(`[research.run] Starting simulation from ${args.requestFile}`);

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Run simulation
  const artifact = await runSingleSimulation(request, experimentCtx);

  logger.info(`[research.run] Completed simulation ${artifact.metadata.runId}`);

  return {
    runId: artifact.metadata.runId,
    artifact,
  };
}
