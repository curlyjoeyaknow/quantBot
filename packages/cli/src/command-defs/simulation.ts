import { z } from 'zod';

export const runSchema = z.object({
  strategy: z.string().min(1),
  caller: z.string().optional(),
  from: z.string(),
  to: z.string(),
  interval: z.enum(['1m', '5m', '15m', '1h']).default('1m'),
  preWindow: z.coerce.number().int().min(0).default(0),
  postWindow: z.coerce.number().int().min(0).default(0),
  dryRun: z.boolean().default(false),
  concurrency: z.coerce.number().int().min(1).max(64).default(8),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const listRunsSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type RunSimulationArgs = z.infer<typeof runSchema>;
export type ListRunsArgs = z.infer<typeof listRunsSchema>;
