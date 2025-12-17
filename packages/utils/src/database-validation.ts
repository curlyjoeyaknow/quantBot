/**
 * Database Input Validation Schemas
 *
 * Uses Zod to validate inputs to database functions, preventing invalid data
 * and providing clear error messages.
 */

import { z } from 'zod';
import { Chain, TokenAddress, Strategy, StopLossConfig } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';
import { ValidationError } from './errors.js';

/**
 * Validates a Chain value
 */
const chainSchema = z.enum(['solana', 'ethereum', 'bsc', 'base']);

/**
 * Validates a TokenAddress (mint address)
 * Must be 32-44 characters
 */
export const tokenAddressSchema = z
  .string()
  .min(32, 'Token address must be at least 32 characters')
  .max(44, 'Token address must be at most 44 characters')
  .refine(
    (val) => {
      try {
        createTokenAddress(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid token address format' }
  )
  .transform((val) => createTokenAddress(val));

/**
 * Validates a Strategy array
 */
const strategySchema = z.array(
  z.object({
    type: z.enum(['entry', 'exit', 'scale_in', 'scale_out']),
    price: z.number().optional(),
    percent: z.number().min(0).max(100).optional(),
    multiplier: z.number().positive().optional(),
    conditions: z.record(z.string(), z.unknown()).optional(),
  })
);

/**
 * Validates a StopLossConfig
 */
const stopLossConfigSchema = z.object({
  type: z.enum(['fixed', 'trailing', 'none']).optional(),
  value: z.number().positive().optional(),
  trailingPercent: z.number().min(0).max(100).optional(),
  maxLossPercent: z.number().min(0).max(100).optional(),
});

/**
 * Schema for saving a strategy
 */
export const saveStrategySchema = z.object({
  userId: z.number().int().positive('User ID must be a positive integer'),
  name: z.string().min(1, 'Strategy name is required').max(100, 'Strategy name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  strategy: strategySchema,
  stopLossConfig: stopLossConfigSchema,
  isDefault: z.boolean().optional(),
});

/**
 * Schema for saving a simulation run
 */
export const saveSimulationRunSchema = z.object({
  userId: z.number().int().positive('User ID must be a positive integer'),
  mint: tokenAddressSchema,
  chain: chainSchema,
  tokenName: z.string().max(100).optional(),
  tokenSymbol: z.string().max(20).optional(),
  startTime: z
    .union([z.date(), z.string()])
    .transform((val) => (val instanceof Date ? val : new Date(val))),
  endTime: z
    .union([z.date(), z.string()])
    .transform((val) => (val instanceof Date ? val : new Date(val))),
  strategy: strategySchema,
  stopLossConfig: stopLossConfigSchema.optional(),
  strategyName: z.string().max(100).optional(),
  finalPnl: z.number().optional(),
  totalCandles: z.number().int().nonnegative().optional(),
  entryType: z.string().max(50).optional(),
  entryPrice: z.number().positive().optional(),
  entryTimestamp: z.number().int().nonnegative().optional(),
  filterCriteria: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for saving CA tracking
 */
export const saveCATrackingSchema = z.object({
  userId: z.number().int().positive('User ID must be a positive integer'),
  chatId: z.number().int().optional(),
  mint: tokenAddressSchema,
  chain: chainSchema,
  tokenName: z.string().max(100).optional(),
  tokenSymbol: z.string().max(20).optional(),
  callPrice: z.number().positive('Call price must be positive'),
  callMarketcap: z.number().nonnegative().optional(),
  callTimestamp: z.number().int().nonnegative('Call timestamp must be non-negative'),
  strategy: strategySchema,
  stopLossConfig: stopLossConfigSchema.optional(),
});

/**
 * Schema for saving a CA call
 */
export const saveCACallSchema = z.object({
  mint: tokenAddressSchema,
  chain: chainSchema,
  token_name: z.string().max(100).optional(),
  token_symbol: z.string().max(20).optional(),
  call_price: z.number().positive().optional(),
  call_marketcap: z.number().nonnegative().optional(),
  call_timestamp: z.number().int().nonnegative('Call timestamp must be non-negative'),
  caller: z.string().max(100).optional(),
});

/**
 * Schema for user ID parameter
 */
export const userIdSchema = z.number().int().positive('User ID must be a positive integer');

/**
 * Schema for run ID parameter
 */
export const runIdSchema = z.number().int().positive('Run ID must be a positive integer');

/**
 * Schema for CA ID parameter
 */
export const caIdSchema = z.number().int().positive('CA ID must be a positive integer');

/**
 * Schema for mint address parameter
 */
export const mintAddressSchema = tokenAddressSchema;

/**
 * Schema for caller name parameter
 */
export const callerNameSchema = z
  .string()
  .min(1, 'Caller name is required')
  .max(100, 'Caller name too long');

/**
 * Schema for chain parameter
 */
export const chainParamSchema = chainSchema;

/**
 * Schema for limit parameter
 */
export const limitSchema = z
  .number()
  .int()
  .positive()
  .max(1000, 'Limit cannot exceed 1000')
  .default(50);

/**
 * Schema for hours parameter
 */
export const hoursSchema = z
  .number()
  .int()
  .positive()
  .max(8760, 'Hours cannot exceed 8760 (1 year)')
  .default(24);

/**
 * Helper function to validate and throw if invalid
 */
export function validateOrThrow<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Zod 4.x uses 'issues' instead of 'errors'
    const issues = result.error.issues || (result.error as any).errors || [];
    const errors = issues.map((e: any) => `${(e.path || []).join('.')}: ${e.message}`).join(', ');
    throw new ValidationError(`Database validation failed: ${errors}`, {
      errors: result.error.issues,
    });
  }
  return result.data;
}

/**
 * Helper function to validate and return result
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
