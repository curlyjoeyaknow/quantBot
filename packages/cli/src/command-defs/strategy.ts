import { z } from 'zod';

/**
 * Strategy diff schema
 */
export const strategyDiffSchema = z.object({
  strategy1: z.string().min(1, 'Strategy 1 path or ID is required'),
  strategy2: z.string().min(1, 'Strategy 2 path or ID is required'),
  format: z.enum(['json', 'table', 'text']).optional().default('text'),
  output: z.string().optional(),
});

export type StrategyDiffArgs = z.infer<typeof strategyDiffSchema>;

/**
 * Strategy compare schema
 */
export const strategyCompareSchema = z.object({
  strategy1: z.string().min(1, 'Strategy 1 path or ID is required'),
  strategy2: z.string().min(1, 'Strategy 2 path or ID is required'),
  format: z.enum(['json', 'table', 'text']).optional().default('text'),
});

export type StrategyCompareArgs = z.infer<typeof strategyCompareSchema>;

/**
 * Strategy versions schema
 */
export const strategyVersionsSchema = z.object({
  strategyId: z.string().min(1, 'Strategy ID is required'),
  format: z.enum(['json', 'table', 'text']).optional().default('table'),
});

export type StrategyVersionsArgs = z.infer<typeof strategyVersionsSchema>;

/**
 * Strategy comparison web UI schema
 */
export const strategyCompareWebSchema = z.object({
  port: z.number().int().positive().optional().default(3002),
  host: z.string().optional().default('localhost'),
});

export type StrategyCompareWebArgs = z.infer<typeof strategyCompareWebSchema>;
