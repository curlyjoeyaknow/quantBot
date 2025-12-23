/**
 * Research Command Definitions
 *
 * Shared schemas and types for research OS commands.
 */

import { z } from 'zod';

/**
 * Run command schema - runs a single simulation from a request JSON file
 */
export const researchRunSchema = z.object({
  requestFile: z.string().min(1, 'Request file path is required'),
  format: z.enum(['json', 'table']).default('table'),
});

export type ResearchRunArgs = z.infer<typeof researchRunSchema>;

/**
 * Batch command schema - runs batch simulations from a batch JSON file
 */
export const researchBatchSchema = z.object({
  batchFile: z.string().min(1, 'Batch file path is required'),
  format: z.enum(['json', 'table']).default('table'),
});

export type ResearchBatchArgs = z.infer<typeof researchBatchSchema>;

/**
 * Sweep command schema - runs parameter sweep from a sweep JSON file
 */
export const researchSweepSchema = z.object({
  sweepFile: z.string().min(1, 'Sweep file path is required'),
  format: z.enum(['json', 'table']).default('table'),
});

export type ResearchSweepArgs = z.infer<typeof researchSweepSchema>;

/**
 * Replay command schema - replays a simulation by run ID
 */
export const researchReplaySchema = z.object({
  runId: z.string().min(1, 'Run ID is required'),
  format: z.enum(['json', 'table']).default('table'),
});

export type ResearchReplayArgs = z.infer<typeof researchReplaySchema>;

/**
 * List command schema - lists all simulation runs
 */
export const researchListSchema = z.object({
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export type ResearchListArgs = z.infer<typeof researchListSchema>;

/**
 * Show command schema - shows details of a specific run
 */
export const researchShowSchema = z.object({
  runId: z.string().min(1, 'Run ID is required'),
  format: z.enum(['json', 'table']).default('table'),
});

export type ResearchShowArgs = z.infer<typeof researchShowSchema>;
