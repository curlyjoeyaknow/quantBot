/**
 * Batch Research Simulation Handler
 */

import { readFile } from 'fs/promises';
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { researchBatchSchema } from '../../command-defs/research.js';
import { runBatchSimulation, createExperimentContext } from '@quantbot/workflows';
import type { BatchSimulationRequest } from '@quantbot/workflows';
import { logger } from '@quantbot/infra/utils';

export type BatchSimulationArgs = z.infer<typeof researchBatchSchema>;

/**
 * Run batch simulations from a batch JSON file
 */
export async function batchSimulationHandler(args: BatchSimulationArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  // Read batch file
  const batchContent = await readFile(args.batchFile, 'utf-8');
  const batchRequest: BatchSimulationRequest = JSON.parse(batchContent);

  logger.info(`[research.batch] Starting batch simulation from ${args.batchFile}`);

  // Create experiment context
  const experimentCtx = createExperimentContext({
    artifactBaseDir: process.cwd(),
  });

  // Run batch simulation
  const result = await runBatchSimulation(batchRequest, experimentCtx);

  logger.info(`[research.batch] Completed batch simulation with ${result.runIds.length} runs`);

  return result;
}
