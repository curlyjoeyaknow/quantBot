/**
 * Experiment Command Definitions
 *
 * CLI commands for querying experiments.
 */

import { z } from 'zod';

/**
 * List experiments schema
 */
export const listExperimentsSchema = z.object({
  experimentId: z.string().optional(),
  strategyId: z.string().optional(),
  parameterHash: z.string().optional(),
  gitCommit: z.string().optional(),
  dataSnapshot: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  startedAfter: z.string().optional(),
  startedBefore: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Get experiment schema
 */
export const getExperimentSchema = z.object({
  experimentId: z.string(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Find experiments by parameter hash schema
 */
export const findExperimentsByParameterSchema = z.object({
  parameterHash: z.string(),
  limit: z.number().int().positive().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

