/**
 * Execution Reality Models - Type Definitions
 * ============================================
 *
 * Core types for execution models, cost models, and risk frameworks.
 * These are JSON-serializable and designed to be consumed by Branch A (simulation engine).
 */

import { z } from 'zod';

// =============================================================================
// Latency Models
// =============================================================================

/**
 * Latency distribution configuration
 * Supports percentile-based distributions (p50, p90, p99) with optional jitter
 */
export const LatencyDistributionSchema = z.object({
  /** Median latency in milliseconds */
  p50: z.number().nonnegative(),
  /** 90th percentile latency in milliseconds */
  p90: z.number().nonnegative(),
  /** 99th percentile latency in milliseconds */
  p99: z.number().nonnegative(),
  /** Optional jitter model (uniform random jitter in ms) */
  jitterMs: z.number().nonnegative().default(0),
  /** Distribution type: 'percentile' uses p50/p90/p99, 'normal' uses mean/stddev */
  distribution: z.enum(['percentile', 'normal']).default('percentile'),
  /** For normal distribution: mean latency in ms */
  meanMs: z.number().nonnegative().optional(),
  /** For normal distribution: standard deviation in ms */
  stddevMs: z.number().nonnegative().optional(),
});

export type LatencyDistribution = z.infer<typeof LatencyDistributionSchema>;

/**
 * Venue-specific latency configuration
 */
export const VenueLatencyConfigSchema = z.object({
  /** Venue identifier (e.g., 'pumpfun', 'pumpswap', 'raydium') */
  venue: z.string(),
  /** Network latency (client → RPC → network) */
  networkLatency: LatencyDistributionSchema,
  /** Transaction confirmation latency (submit → confirmed) */
  confirmationLatency: LatencyDistributionSchema,
  /** Optional: latency multiplier during high congestion */
  congestionMultiplier: z.number().min(1).max(10).default(1),
});

export type VenueLatencyConfig = z.infer<typeof VenueLatencyConfigSchema>;

// =============================================================================
// Slippage Models
// =============================================================================

/**
 * Slippage model configuration
 */
export const SlippageModelSchema = z.object({
  /** Model type */
  type: z.enum(['fixed', 'linear', 'sqrt', 'volume-based']),
  /** Fixed slippage in basis points (for 'fixed' type) */
  fixedBps: z.number().nonnegative().default(0),
  /** Linear slippage coefficient (bps per unit of trade size) */
  linearCoefficient: z.number().nonnegative().default(0),
  /** Square root slippage coefficient (bps per sqrt(unit) of trade size) */
  sqrtCoefficient: z.number().nonnegative().default(0),
  /** Volume-based slippage: impact per unit of volume */
  volumeImpactBps: z.number().nonnegative().default(0),
  /** Minimum slippage floor in bps */
  minBps: z.number().nonnegative().default(0),
  /** Maximum slippage cap in bps */
  maxBps: z.number().nonnegative().default(10_000),
});

export type SlippageModel = z.infer<typeof SlippageModelSchema>;

/**
 * Venue-specific slippage configuration
 */
export const VenueSlippageConfigSchema = z.object({
  /** Venue identifier */
  venue: z.string(),
  /** Entry slippage model */
  entrySlippage: SlippageModelSchema,
  /** Exit slippage model */
  exitSlippage: SlippageModelSchema,
  /** Optional: slippage multiplier during high volatility */
  volatilityMultiplier: z.number().min(1).max(5).default(1),
});

export type VenueSlippageConfig = z.infer<typeof VenueSlippageConfigSchema>;

// =============================================================================
// Failure Models
// =============================================================================

/**
 * Transaction failure probability model
 */
export const FailureModelSchema = z.object({
  /** Base failure rate (0-1) */
  baseFailureRate: z.number().min(0).max(1).default(0),
  /** Failure rate increase per unit of congestion (0-1) */
  congestionFailureRate: z.number().min(0).max(1).default(0),
  /** Failure rate increase per unit of priority fee shortfall (0-1) */
  feeShortfallFailureRate: z.number().min(0).max(1).default(0),
  /** Maximum failure rate cap (0-1) */
  maxFailureRate: z.number().min(0).max(1).default(0.5),
});

export type FailureModel = z.infer<typeof FailureModelSchema>;

/**
 * Partial fill model
 */
export const PartialFillModelSchema = z.object({
  /** Probability of partial fill (0-1) */
  probability: z.number().min(0).max(1).default(0),
  /** Distribution of fill percentage when partial fill occurs (0-1) */
  fillDistribution: z
    .object({
      type: z.enum(['uniform', 'normal', 'beta']),
      /** For uniform: min fill percentage */
      minFill: z.number().min(0).max(1).default(0.5),
      /** For uniform: max fill percentage */
      maxFill: z.number().min(0).max(1).default(1),
      /** For normal: mean fill percentage */
      meanFill: z.number().min(0).max(1).optional(),
      /** For normal: stddev fill percentage */
      stddevFill: z.number().nonnegative().optional(),
      /** For beta: alpha parameter */
      alpha: z.number().positive().optional(),
      /** For beta: beta parameter */
      beta: z.number().positive().optional(),
    })
    .optional(),
});

export type PartialFillModel = z.infer<typeof PartialFillModelSchema>;

/**
 * Reorg/chain reorganization model
 */
export const ReorgModelSchema = z.object({
  /** Probability of reorg affecting transaction (0-1) */
  probability: z.number().min(0).max(1).default(0),
  /** Average depth before reorg (blocks) */
  averageDepth: z.number().positive().default(1),
  /** Maximum reorg depth (blocks) */
  maxDepth: z.number().positive().default(1),
});

export type ReorgModel = z.infer<typeof ReorgModelSchema>;

// =============================================================================
// Cost Models (Enhanced)
// =============================================================================

/**
 * Enhanced cost model with priority fees and compute costs
 */
export const CostModelSchema = z.object({
  /** Base taker fee in basis points */
  takerFeeBps: z.number().int().min(0).max(10_000).default(25),
  /** Base maker fee in basis points (if applicable) */
  makerFeeBps: z.number().int().min(0).max(10_000).default(0),
  /** Priority fee configuration */
  priorityFee: z
    .object({
      /** Base priority fee in micro-lamports per compute unit */
      baseMicroLamportsPerCu: z.number().nonnegative().default(0),
      /** Priority fee multiplier during congestion */
      congestionMultiplier: z.number().min(1).max(100).default(1),
      /** Maximum priority fee cap */
      maxMicroLamportsPerCu: z.number().nonnegative().default(1_000_000),
    })
    .optional(),
  /** Compute unit costs */
  computeUnits: z
    .object({
      /** Average compute units per transaction */
      averageCu: z.number().positive().default(200_000),
      /** Compute unit price in lamports per CU (if applicable) */
      cuPriceLamports: z.number().nonnegative().default(0),
    })
    .optional(),
  /** Borrow APR for short positions in basis points */
  borrowAprBps: z.number().int().min(0).max(100_000).default(0),
});

export type CostModel = z.infer<typeof CostModelSchema>;

// =============================================================================
// Execution Model (Composite)
// =============================================================================

/**
 * Complete execution model combining latency, slippage, failures, and costs
 */
export const ExecutionModelSchema = z.object({
  /** Model identifier */
  id: z.string().optional(),
  /** Model name/description */
  name: z.string().optional(),
  /** Venue identifier */
  venue: z.string(),
  /** Latency configuration */
  latency: VenueLatencyConfigSchema,
  /** Slippage configuration */
  slippage: VenueSlippageConfigSchema,
  /** Failure model */
  failures: FailureModelSchema.optional(),
  /** Partial fill model */
  partialFills: PartialFillModelSchema.optional(),
  /** Reorg model */
  reorgs: ReorgModelSchema.optional(),
  /** Cost model */
  costs: CostModelSchema,
  /** Optional: metadata for calibration tracking */
  calibrationMetadata: z
    .object({
      /** Calibration timestamp (ISO 8601) */
      calibratedAt: z.string().datetime().optional(),
      /** Source of calibration (e.g., 'live-trading', 'paper-trading') */
      source: z.string().optional(),
      /** Sample size used for calibration */
      sampleSize: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ExecutionModel = z.infer<typeof ExecutionModelSchema>;

// =============================================================================
// Risk Models
// =============================================================================

/**
 * Circuit breaker configuration
 */
export const CircuitBreakerConfigSchema = z.object({
  /** Maximum drawdown percentage (0-1) before stopping */
  maxDrawdown: z.number().min(0).max(1).optional(),
  /** Maximum loss per day in base currency */
  maxDailyLoss: z.number().nonnegative().optional(),
  /** Maximum consecutive losses before stopping */
  maxConsecutiveLosses: z.number().int().positive().optional(),
  /** Maximum exposure per strategy (in base currency) */
  maxExposurePerStrategy: z.number().nonnegative().optional(),
  /** Maximum total exposure across all strategies */
  maxTotalExposure: z.number().nonnegative().optional(),
  /** Trade throttle: minimum seconds between trades */
  minTradeIntervalSeconds: z.number().nonnegative().default(0),
  /** Maximum trades per hour */
  maxTradesPerHour: z.number().int().positive().optional(),
  /** Maximum trades per day */
  maxTradesPerDay: z.number().int().positive().optional(),
});

export type CircuitBreakerConfig = z.infer<typeof CircuitBreakerConfigSchema>;

/**
 * Anomaly detection configuration
 */
export const AnomalyDetectionConfigSchema = z.object({
  /** Enable anomaly detection */
  enabled: z.boolean().default(false),
  /** Latency spike threshold (multiple of p99) */
  latencySpikeThreshold: z.number().min(1).max(10).default(3),
  /** Abnormal slippage threshold (multiple of expected) */
  slippageSpikeThreshold: z.number().min(1).max(10).default(3),
  /** Failure rate spike threshold (multiple of base rate) */
  failureRateSpikeThreshold: z.number().min(1).max(10).default(3),
  /** Window size for anomaly detection (seconds) */
  windowSizeSeconds: z.number().positive().default(300),
});

export type AnomalyDetectionConfig = z.infer<typeof AnomalyDetectionConfigSchema>;

/**
 * Complete risk framework configuration
 */
export const RiskFrameworkSchema = z.object({
  /** Circuit breakers */
  circuitBreakers: CircuitBreakerConfigSchema,
  /** Anomaly detection */
  anomalyDetection: AnomalyDetectionConfigSchema.optional(),
  /** Optional: risk limits per venue */
  venueLimits: z.record(z.string(), CircuitBreakerConfigSchema).optional(),
});

export type RiskFramework = z.infer<typeof RiskFrameworkSchema>;
