/**
 * Telemetry schemas for live execution monitoring
 *
 * Captures slippage deltas, latency drift, and unexpected failures
 * to calibrate execution models.
 */

import { z } from 'zod';

/**
 * Slippage event - actual vs expected slippage
 */
export const SlippageEventSchema = z.object({
  timestamp: z.number(),
  runId: z.string(),
  strategyId: z.string(),
  mint: z.string(),
  side: z.enum(['buy', 'sell']),
  expectedSlippageBps: z.number(),
  actualSlippageBps: z.number(),
  deltaBps: z.number(),
  expectedPrice: z.number(),
  actualPrice: z.number(),
  quantity: z.number(),
});

export type SlippageEvent = z.infer<typeof SlippageEventSchema>;

/**
 * Latency event - actual vs expected execution latency
 */
export const LatencyEventSchema = z.object({
  timestamp: z.number(),
  runId: z.string(),
  strategyId: z.string(),
  mint: z.string(),
  orderType: z.enum(['market', 'limit']),
  expectedLatencyMs: z.number(),
  actualLatencyMs: z.number(),
  deltaMs: z.number(),
  signalTimestamp: z.number(),
  executionTimestamp: z.number(),
});

export type LatencyEvent = z.infer<typeof LatencyEventSchema>;

/**
 * Failure event - unexpected execution failures
 */
export const FailureEventSchema = z.object({
  timestamp: z.number(),
  runId: z.string(),
  strategyId: z.string(),
  mint: z.string(),
  failureType: z.enum([
    'transaction_failed',
    'insufficient_liquidity',
    'timeout',
    'network_error',
    'other',
  ]),
  errorMessage: z.string(),
  expectedSuccessProbability: z.number(),
  retryAttempts: z.number(),
  recovered: z.boolean(),
});

export type FailureEvent = z.infer<typeof FailureEventSchema>;

/**
 * Telemetry summary - aggregated metrics over a time window
 */
export const TelemetrySummarySchema = z.object({
  runId: z.string(),
  strategyId: z.string(),
  windowStart: z.number(),
  windowEnd: z.number(),

  // Slippage metrics
  slippage: z.object({
    avgExpectedBps: z.number(),
    avgActualBps: z.number(),
    avgDeltaBps: z.number(),
    stdDevDeltaBps: z.number(),
    maxDeltaBps: z.number(),
    eventCount: z.number(),
  }),

  // Latency metrics
  latency: z.object({
    avgExpectedMs: z.number(),
    avgActualMs: z.number(),
    avgDeltaMs: z.number(),
    stdDevDeltaMs: z.number(),
    maxDeltaMs: z.number(),
    eventCount: z.number(),
  }),

  // Failure metrics
  failures: z.object({
    totalFailures: z.number(),
    failureRate: z.number(),
    failuresByType: z.record(z.string(), z.number()),
    recoveryRate: z.number(),
  }),
});

export type TelemetrySummary = z.infer<typeof TelemetrySummarySchema>;

/**
 * Model calibration recommendation
 */
export const CalibrationRecommendationSchema = z.object({
  runId: z.string(),
  strategyId: z.string(),
  timestamp: z.number(),

  // Recommended adjustments
  slippageAdjustment: z
    .object({
      currentBps: z.number(),
      recommendedBps: z.number(),
      confidence: z.number(),
      reason: z.string(),
    })
    .optional(),

  latencyAdjustment: z
    .object({
      currentMs: z.number(),
      recommendedMs: z.number(),
      confidence: z.number(),
      reason: z.string(),
    })
    .optional(),

  failureProbabilityAdjustment: z
    .object({
      currentProbability: z.number(),
      recommendedProbability: z.number(),
      confidence: z.number(),
      reason: z.string(),
    })
    .optional(),
});

export type CalibrationRecommendation = z.infer<typeof CalibrationRecommendationSchema>;
