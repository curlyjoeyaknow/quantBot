/**
 * Artifact Command Definitions
 */

import { z } from 'zod';

export const artifactsListSchema = z.object({
  type: z
    .enum([
      'strategy',
      'feature_set',
      'simulation_run',
      'parameter_sweep',
      'data_snapshot',
      'execution_config',
      'cost_model',
    ])
    .optional(),
  tags: z.array(z.string()).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const artifactsGetSchema = z.object({
  id: z.string().min(1),
  version: z.string().optional(),
  format: z.enum(['json', 'table']).default('table'),
});

export const artifactsTagSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  tags: z.array(z.string()).min(1),
});
