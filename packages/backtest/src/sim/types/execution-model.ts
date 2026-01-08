/**
 * Execution Model Schema
 *
 * Defines how trades are executed in simulation:
 * - Latency distributions
 * - Slippage models
 * - Partial fills
 * - Failed transactions
 * - Fee regimes
 *
 * No "perfect fills" - all execution must be simulated explicitly.
 */

import { z } from 'zod';

/**
 * Latency distribution configuration
 */
export const LatencyDistributionSchema = z.object({
  /**
   * Distribution type
   */
  type: z.enum(['fixed', 'uniform', 'normal', 'exponential']),

  /**
   * Parameters for distribution
   * - fixed: { value: number } (ms)
   * - uniform: { min: number, max: number } (ms)
   * - normal: { mean: number, stdDev: number } (ms)
   * - exponential: { lambda: number } (1/mean)
   */
  params: z.record(z.string(), z.number()),
});

export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>;

/**
 * Slippage model configuration
 */
export const SlippageModelSchema = z.object({
  /**
   * Model type
   */
  type: z.enum(['fixed', 'linear', 'sqrt', 'constant_product']),

  /**
   * Parameters for slippage model
   * - fixed: { bps: number } (basis points)
   * - linear: { bpsPerUnit: number } (basis points per unit of trade size)
   * - sqrt: { bpsPerSqrtUnit: number }
   * - constant_product: { liquidity: number, feeBps: number }
   */
  params: z.record(z.string(), z.number()),
});

export type SlippageModel = z.infer<typeof SlippageModelSchema>;

/**
 * Partial fill model
 */
export const PartialFillModelSchema = z.object({
  /**
   * Model type
   */
  type: z.enum(['none', 'probabilistic', 'liquidity_based']),

  /**
   * Parameters
   * - probabilistic: { fillProbability: number } (0-1)
   * - liquidity_based: { minLiquidity: number, fillRatio: number }
   */
  params: z.record(z.string(), z.number()).optional(),
});

export type PartialFillModel = z.infer<typeof PartialFillModelSchema>;

/**
 * Transaction failure model
 */
export const FailureModelSchema = z.object({
  /**
   * Failure probability (0-1)
   */
  failureProbability: z.number().min(0).max(1).default(0),

  /**
   * Retry configuration
   */
  retry: z
    .object({
      maxRetries: z.number().int().min(0).default(0),
      backoffMs: z.number().int().min(0).default(1000),
    })
    .optional(),
});

export type FailureModel = z.infer<typeof FailureModelSchema>;

/**
 * Fee regime
 */
export const FeeRegimeSchema = z.object({
  /**
   * Entry fee (basis points)
   */
  entryFeeBps: z.number().int().min(0).default(0),

  /**
   * Exit fee (basis points)
   */
  exitFeeBps: z.number().int().min(0).default(0),

  /**
   * Maker fee (basis points, optional)
   */
  makerFeeBps: z.number().int().min(0).optional(),

  /**
   * Taker fee (basis points, optional)
   */
  takerFeeBps: z.number().int().min(0).optional(),

  /**
   * Priority fee (for Solana, in micro-lamports per compute unit)
   */
  priorityFee: z.number().int().min(0).optional(),
});

export type FeeRegime = z.infer<typeof FeeRegimeSchema>;

/**
 * Execution model configuration
 */
export const ExecutionModelSchema = z.object({
  /**
   * Latency distribution
   */
  latency: LatencyDistributionSchema.optional(),

  /**
   * Slippage model
   */
  slippage: SlippageModelSchema.optional(),

  /**
   * Partial fill model
   */
  partialFills: PartialFillModelSchema.optional(),

  /**
   * Transaction failure model
   */
  failures: FailureModelSchema.optional(),

  /**
   * Fee regime
   */
  fees: FeeRegimeSchema.optional(),
});

export type ExecutionModel = z.infer<typeof ExecutionModelSchema>;
