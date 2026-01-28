/**
 * Optimize Workflow Handler
 *
 * Runs the complete optimization workflow (Phase 1 → Phase 2 → Phase 3).
 */

import { readFile } from 'fs/promises';
import type { CommandContext } from '../../core/command-context.js';
import type { ResearchOptimizeArgs } from '../../command-defs/research.js';
import { runOptimizationWorkflow } from '@quantbot/workflows/research/optimization-workflow.js';
import { OptimizationWorkflowConfigSchema } from '@quantbot/workflows/research/phases/types.js';
import { loadConfig } from '../../core/config-loader.js';

/**
 * Run optimization workflow handler
 */
export async function optimizeWorkflowHandler(
  args: ResearchOptimizeArgs,
  _ctx: CommandContext
): Promise<unknown> {
  // Load config from file
  const configContent = await readFile(args.config, 'utf-8');
  const configJson = JSON.parse(configContent);

  // Merge CLI overrides
  const finalConfig = {
    ...configJson,
    resume: args.resume,
  };

  // Validate config
  const config = OptimizationWorkflowConfigSchema.parse(finalConfig);

  // Run workflow
  const result = await runOptimizationWorkflow(config);

  return result;
}
