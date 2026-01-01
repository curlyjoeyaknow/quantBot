import { z } from 'zod';

export const backtestRunSchema = z.object({
  strategy: z.string().min(1), // Mode: exit-optimizer or exit-stack
  strategyId: z.string().optional(), // DuckDB strategy_id (required for exit-stack)
  runId: z.string().optional(), // Run ID (provided by Lab UI, optional for backward compat)
  filter: z.string().optional(),
  interval: z.string().min(1),
  from: z.string(),
  to: z.string(),
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30),
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10),
  positionUsd: z.coerce.number().positive().default(1000),
  includeReplay: z.boolean().default(false),
});

export type BacktestRunArgs = z.infer<typeof backtestRunSchema>;

export const backtestCallersSchema = z.object({
  runId: z.string().min(1),
  sort: z
    .enum([
      'calls',
      'count_2x',
      'count_3x',
      'count_4x',
      'p_hit_2x',
      'p_hit_3x',
      'p_hit_4x',
      'avg_peak_multiple',
    ])
    .optional()
    .default('count_4x'),
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestCallersArgs = z.infer<typeof backtestCallersSchema>;

export const backtestListSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestListArgs = z.infer<typeof backtestListSchema>;

export const backtestLeaderboardSchema = z.object({
  runId: z.string().optional(),
  minCalls: z.coerce.number().int().min(0).default(20),
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestLeaderboardArgs = z.infer<typeof backtestLeaderboardSchema>;
