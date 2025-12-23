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

/**
 * Create snapshot command schema
 */
export const createSnapshotSchema = z.object({
  from: z.string().min(1, 'Start date (ISO 8601) is required'),
  to: z.string().min(1, 'End date (ISO 8601) is required'),
  sources: z
    .array(
      z.object({
        venue: z.string(),
        chain: z.string().optional(),
      })
    )
    .optional(),
  callerNames: z.array(z.string()).optional(),
  mintAddresses: z.array(z.string()).optional(),
  minVolume: z.number().nonnegative().optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export type CreateSnapshotArgs = z.infer<typeof createSnapshotSchema>;

/**
 * Create execution model command schema
 */
export const createExecutionModelSchema = z.object({
  latencySamples: z.array(z.number().nonnegative()).optional(),
  slippageSamples: z
    .array(
      z.object({
        tradeSize: z.number().nonnegative(),
        expectedPrice: z.number().nonnegative(),
        actualPrice: z.number().nonnegative(),
        marketVolume24h: z.number().nonnegative().optional(),
      })
    )
    .optional(),
  failureRate: z.number().min(0).max(1).optional(),
  partialFillRate: z.number().min(0).max(1).optional(),
  venue: z.string().optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export type CreateExecutionModelArgs = z.infer<typeof createExecutionModelSchema>;

/**
 * Create cost model command schema
 */
export const createCostModelSchema = z.object({
  baseFee: z.number().nonnegative().optional(),
  priorityFeeMin: z.number().nonnegative().optional(),
  priorityFeeMax: z.number().nonnegative().optional(),
  tradingFeePercent: z.number().min(0).max(1).optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export type CreateCostModelArgs = z.infer<typeof createCostModelSchema>;

/**
 * Create risk model command schema
 */
export const createRiskModelSchema = z.object({
  maxDrawdownPercent: z.number().min(0).max(100).optional(),
  maxLossPerDay: z.number().nonnegative().optional(),
  maxConsecutiveLosses: z.number().int().nonnegative().optional(),
  maxPositionSize: z.number().nonnegative().optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export type CreateRiskModelArgs = z.infer<typeof createRiskModelSchema>;
