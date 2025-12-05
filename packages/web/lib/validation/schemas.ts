/**
 * Validation Schemas
 * ==================
 * Zod schemas for API request validation
 */

import { z } from 'zod';

/**
 * Pagination schema
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});

/**
 * Date range schema
 */
export const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  },
  { message: 'startDate must be before or equal to endDate' }
);

/**
 * Numeric range schema
 */
export const numericRangeSchema = z.object({
  min: z.coerce.number().optional(),
  max: z.coerce.number().optional(),
}).refine(
  (data) => {
    if (data.min !== undefined && data.max !== undefined) {
      return data.min <= data.max;
    }
    return true;
  },
  { message: 'min must be less than or equal to max' }
);

/**
 * Caller history query schema
 */
export const callerHistoryQuerySchema = z.object({
  caller: z.string().optional(),
  chain: z.enum(['solana', 'base', 'all']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  minPnl: z.coerce.number().optional(),
  maxPnl: z.coerce.number().optional(),
  minMarketCap: z.coerce.number().optional(),
  maxMarketCap: z.coerce.number().optional(),
  minMaxGain: z.coerce.number().optional(),
  maxMaxGain: z.coerce.number().optional(),
  isDuplicate: z.coerce.boolean().optional(),
  ...paginationSchema.shape,
});

/**
 * Strategy job schema
 */
export const strategyJobSchema = z.object({
  batchSize: z.coerce.number().int().min(1).max(1000).default(10),
  maxAlerts: z.coerce.number().int().min(1).optional(),
});

/**
 * Service control schema
 */
export const serviceControlSchema = z.object({
  service: z.string(),
  action: z.enum(['start', 'stop']),
});

/**
 * Config update schema
 */
export const configUpdateSchema = z.object({
  key: z.string().min(1, 'Config key is required'),
  value: z.string(),
});

/**
 * Live trade strategy update schema
 */
export const liveTradeStrategyUpdateSchema = z.object({
  strategyId: z.string(),
  enabled: z.boolean(),
});

/**
 * Live trade strategies batch update schema
 */
export const liveTradeStrategiesBatchUpdateSchema = z.object({
  strategies: z.array(z.object({
    id: z.string(),
    enabled: z.boolean(),
  })),
});

/**
 * Report generation schema
 */
export const reportGenerationSchema = z.object({
  strategyType: z.enum(['tenkan-kijun', 'optimized']),
  strategyName: z.string().optional(),
  simulationTimestamp: z.string().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format'),
  callers: z.array(z.string()).optional(),
  outputDir: z.string().optional(),
  runSimulationsIfMissing: z.boolean().optional().default(false),
  chain: z.enum(['solana', 'all']).optional().default('solana'),
}).refine(
  (data) => {
    if (data.strategyType === 'optimized') {
      return !!data.strategyName && !!data.simulationTimestamp;
    }
    return true;
  },
  { message: 'strategyName and simulationTimestamp are required for optimized strategies' }
).refine(
  (data) => {
    return new Date(data.startDate) <= new Date(data.endDate);
  },
  { message: 'startDate must be before or equal to endDate' }
);
