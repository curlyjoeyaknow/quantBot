/**
 * Research OS - Run Artifacts
 * ============================
 *
 * Artifacts are the immutable outputs of simulation runs.
 * They contain everything needed to:
 * - Reproduce the run
 * - Analyze results
 * - Compare runs
 * - Debug issues
 */

import { z } from 'zod';
import type { SimulationRequest } from './contract.js';

/**
 * TradeEvent - A single trade execution
 */
export const TradeEventSchema = z.object({
  /**
   * Timestamp of the trade (ISO 8601)
   */
  timestampISO: z.string(),

  /**
   * Trade type
   */
  type: z.enum(['entry', 'exit', 'reentry']),

  /**
   * Asset identifier (mint address)
   */
  asset: z.string(),

  /**
   * Price at which trade executed
   */
  price: z.number().positive(),

  /**
   * Quantity traded
   */
  quantity: z.number().positive(),

  /**
   * Total value (price * quantity)
   */
  value: z.number(),

  /**
   * Fees paid
   */
  fees: z.number().nonnegative(),

  /**
   * Slippage incurred (as fraction)
   */
  slippage: z.number().min(0).max(1).optional(),

  /**
   * Latency (milliseconds from signal to execution)
   */
  latencyMs: z.number().nonnegative().optional(),

  /**
   * Whether this was a partial fill
   */
  partialFill: z.boolean().default(false),

  /**
   * Fill percentage (if partial)
   */
  fillPercentage: z.number().min(0).max(1).optional(),

  /**
   * Whether this trade failed
   */
  failed: z.boolean().default(false),

  /**
   * Failure reason (if failed)
   */
  failureReason: z.string().optional(),
});

export type TradeEvent = z.infer<typeof TradeEventSchema>;

/**
 * PnLSeries - Profit and loss over time
 */
export const PnLSeriesSchema = z.object({
  /**
   * Timestamp (ISO 8601)
   */
  timestampISO: z.string(),

  /**
   * Cumulative PnL (as multiplier, e.g., 1.12 = +12%)
   */
  cumulativePnL: z.number(),

  /**
   * Running total (in base currency)
   */
  runningTotal: z.number(),

  /**
   * Drawdown at this point (as fraction, e.g., 0.05 = 5% drawdown)
   */
  drawdown: z.number().min(0).max(1),
});

export type PnLSeries = z.infer<typeof PnLSeriesSchema>;

/**
 * ExposureSeries - Position exposure over time
 */
export const ExposureSeriesSchema = z.object({
  /**
   * Timestamp (ISO 8601)
   */
  timestampISO: z.string(),

  /**
   * Total exposure (in base currency)
   */
  totalExposure: z.number().nonnegative(),

  /**
   * Number of open positions
   */
  openPositions: z.number().int().nonnegative(),

  /**
   * Largest position size
   */
  maxPositionSize: z.number().nonnegative(),
});

export type ExposureSeries = z.infer<typeof ExposureSeriesSchema>;

/**
 * RunMetrics - Comprehensive metrics for a simulation run
 *
 * These are the mandatory metrics that every run must produce.
 */
export const RunMetricsSchema = z.object({
  /**
   * Return metrics
   */
  return: z.object({
    /**
     * Total return (as multiplier, e.g., 1.12 = +12%)
     */
    total: z.number(),

    /**
     * Annualized return (if applicable)
     */
    annualized: z.number().optional(),

    /**
     * Return per trade (average)
     */
    perTrade: z.number().optional(),
  }),

  /**
   * Drawdown metrics
   */
  drawdown: z.object({
    /**
     * Maximum drawdown (as fraction, e.g., 0.2 = 20%)
     */
    max: z.number().min(0).max(1),

    /**
     * Average drawdown
     */
    average: z.number().min(0).max(1).optional(),

    /**
     * Time to recover from max drawdown (milliseconds)
     */
    recoveryTimeMs: z.number().nonnegative().optional(),
  }),

  /**
   * Hit rate (win rate)
   */
  hitRate: z.object({
    /**
     * Overall hit rate (as fraction, e.g., 0.6 = 60%)
     */
    overall: z.number().min(0).max(1),

    /**
     * Hit rate for entries
     */
    entries: z.number().min(0).max(1).optional(),

    /**
     * Hit rate for exits
     */
    exits: z.number().min(0).max(1).optional(),
  }),

  /**
   * Trade count
   */
  trades: z.object({
    /**
     * Total number of trades
     */
    total: z.number().int().nonnegative(),

    /**
     * Number of entries
     */
    entries: z.number().int().nonnegative(),

    /**
     * Number of exits
     */
    exits: z.number().int().nonnegative(),

    /**
     * Number of re-entries
     */
    reentries: z.number().int().nonnegative().optional(),

    /**
     * Number of failed trades
     */
    failed: z.number().int().nonnegative().optional(),
  }),

  /**
   * Tail loss (worst case scenarios)
   */
  tailLoss: z.object({
    /**
     * Worst single trade loss (as fraction, e.g., 0.1 = -10%)
     */
    worstTrade: z.number().max(0),

    /**
     * 5th percentile loss
     */
    p5: z.number().optional(),

    /**
     * 1st percentile loss
     */
    p1: z.number().optional(),
  }),

  /**
   * Fee sensitivity
   */
  feeSensitivity: z.object({
    /**
     * Total fees paid (in base currency)
     */
    totalFees: z.number().nonnegative(),

    /**
     * Fees as percentage of total return
     */
    feesAsPercentOfReturn: z.number().optional(),

    /**
     * Average fee per trade
     */
    averageFeePerTrade: z.number().nonnegative().optional(),
  }),

  /**
   * Latency sensitivity (if latency was modeled)
   */
  latencySensitivity: z
    .object({
      /**
       * Average latency (milliseconds)
       */
      averageLatencyMs: z.number().nonnegative(),

      /**
       * P90 latency (milliseconds)
       */
      p90LatencyMs: z.number().nonnegative().optional(),

      /**
       * P99 latency (milliseconds)
       */
      p99LatencyMs: z.number().nonnegative().optional(),

      /**
       * Trades that exceeded latency threshold
       */
      exceededThresholdCount: z.number().int().nonnegative().optional(),
    })
    .optional(),

  /**
   * Risk metrics
   */
  risk: z
    .object({
      /**
       * Sharpe ratio (if applicable)
       */
      sharpeRatio: z.number().optional(),

      /**
       * Sortino ratio (if applicable)
       */
      sortinoRatio: z.number().optional(),

      /**
       * Maximum exposure reached
       */
      maxExposure: z.number().nonnegative().optional(),

      /**
       * Number of times risk limits were hit
       */
      riskLimitHits: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type RunMetrics = z.infer<typeof RunMetricsSchema>;

/**
 * RunMetadata - Immutable metadata about the run
 *
 * This enables reproducibility and traceability.
 */
export const RunMetadataSchema = z.object({
  /**
   * Unique run ID
   */
  runId: z.string().min(1),

  /**
   * Git commit SHA at time of run
   */
  gitSha: z.string().regex(/^[a-f0-9]{40}$/, 'Must be full git SHA'),

  /**
   * Git branch name
   */
  gitBranch: z.string().optional(),

  /**
   * When the run was created (ISO 8601)
   */
  createdAtISO: z.string(),

  /**
   * Data snapshot hash (from DataSnapshotRef)
   */
  dataSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),

  /**
   * Strategy config hash (from StrategyRef)
   */
  strategyConfigHash: z.string().regex(/^[a-f0-9]{64}$/),

  /**
   * Execution model hash (SHA-256 of serialized model)
   */
  executionModelHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),

  /**
   * Cost model hash (SHA-256 of serialized model)
   */
  costModelHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),

  /**
   * Risk model hash (SHA-256 of serialized model)
   */
  riskModelHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),

  /**
   * Run config hash (SHA-256 of serialized config)
   */
  runConfigHash: z.string().regex(/^[a-f0-9]{64}$/),

  /**
   * Total simulation time (milliseconds)
   */
  simulationTimeMs: z.number().nonnegative(),

  /**
   * Version of the artifact schema
   */
  schemaVersion: z.string().default('1.0.0'),
});

export type RunMetadata = z.infer<typeof RunMetadataSchema>;

/**
 * RunArtifact - Complete output of a simulation run
 *
 * This is the immutable, versioned artifact that contains everything
 * needed to reproduce, analyze, and compare runs.
 */
export const RunArtifactSchema = z.object({
  /**
   * Metadata (immutable, versioned)
   */
  metadata: RunMetadataSchema,

  /**
   * Original request (for reproducibility)
   */
  request: z.any(), // SimulationRequestSchema, but avoiding circular import

  /**
   * Trade events (all trades executed)
   */
  tradeEvents: z.array(TradeEventSchema),

  /**
   * PnL series (cumulative PnL over time)
   */
  pnlSeries: z.array(PnLSeriesSchema),

  /**
   * Exposure series (position exposure over time)
   */
  exposureSeries: z.array(ExposureSeriesSchema).optional(),

  /**
   * Comprehensive metrics
   */
  metrics: RunMetricsSchema,

  /**
   * Event logs (detailed execution log, if enabled)
   */
  eventLogs: z.array(z.unknown()).optional(),

  /**
   * State snapshots (intermediate state, if enabled)
   */
  stateSnapshots: z.array(z.unknown()).optional(),

  /**
   * Errors encountered (if errorMode was 'collect')
   */
  errors: z
    .array(
      z.object({
        timestampISO: z.string(),
        errorCode: z.string(),
        errorMessage: z.string(),
        context: z.unknown().optional(),
      })
    )
    .optional(),
});

export type RunArtifact = z.infer<typeof RunArtifactSchema>;

/**
 * Artifact guarantees:
 *
 * 1. Immutability: Once created, artifacts never change
 * 2. Completeness: All required fields are always present
 * 3. Versioning: Schema version enables evolution
 * 4. Traceability: Full metadata enables reproduction
 * 5. JSON-serializable: Can be stored, transmitted, compared
 */
