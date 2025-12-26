/**
 * Research OS - Simulation Contract
 * ==================================
 *
 * This is the immutable "physics API" for the research lab.
 * All simulations must conform to this contract.
 *
 * The contract defines:
 * - Inputs: What data and configuration a simulation needs
 * - Outputs: What artifacts a simulation must produce
 * - Guarantees: Determinism, replayability, versioning
 */

import { z } from 'zod';
import type { DateTime } from 'luxon';

/**
 * DataSnapshotRef - Reference to a reproducible data snapshot
 *
 * A snapshot is a time-machine slice of market data:
 * - What sources (venues, chains)
 * - What time range
 * - What filters
 * - What version of transforms
 *
 * The hash ensures we can verify we're using the exact same data.
 */
export const DataSnapshotRefSchema = z.object({
  /**
   * Unique identifier for this snapshot
   */
  snapshotId: z.string().min(1),

  /**
   * Content hash of the snapshot (SHA-256)
   * Used to verify data integrity and detect changes
   */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be SHA-256 hash'),

  /**
   * Time range covered by this snapshot
   */
  timeRange: z.object({
    fromISO: z.string(),
    toISO: z.string(),
  }),

  /**
   * Sources included in this snapshot
   */
  sources: z.array(
    z.object({
      venue: z.string(), // e.g., "pump.fun", "birdeye"
      chain: z.string().optional(), // e.g., "solana", "base"
    })
  ),

  /**
   * Filters applied to create this snapshot
   */
  filters: z
    .object({
      callerNames: z.array(z.string()).optional(),
      mintAddresses: z.array(z.string()).optional(),
      minVolume: z.number().optional(),
    })
    .optional(),

  /**
   * Version of the canonical schema used
   */
  schemaVersion: z.string().default('1.0.0'),

  /**
   * When this snapshot was created
   */
  createdAtISO: z.string(),

  /**
   * Optional: Slice manifest IDs that this snapshot references
   * 
   * If provided, the snapshot data is loaded from these slice manifests (parquet files)
   * instead of querying databases directly. This is the preferred approach.
   */
  sliceManifestIds: z.array(z.string()).optional(),
});

export type DataSnapshotRef = z.infer<typeof DataSnapshotRefSchema>;

/**
 * StrategyRef - Reference to a strategy definition
 *
 * Strategies are versioned, immutable definitions.
 * The config hash ensures we can verify we're using the exact same strategy.
 */
export const StrategyRefSchema = z.object({
  /**
   * Unique identifier for this strategy
   */
  strategyId: z.string().min(1),

  /**
   * Human-readable name
   */
  name: z.string().min(1),

  /**
   * Full strategy configuration (opaque to contract, but must be serializable)
   * This is the complete strategy definition for reproducibility
   */
  config: z.unknown(),

  /**
   * Hash of the config (SHA-256)
   * Used to verify strategy integrity and detect changes
   */
  configHash: z.string().regex(/^[a-f0-9]{64}$/, 'Must be SHA-256 hash'),

  /**
   * Version of the strategy schema used
   */
  schemaVersion: z.string().default('1.0.0'),
});

export type StrategyRef = z.infer<typeof StrategyRefSchema>;

/**
 * ExecutionModel - How trades are executed in simulation
 *
 * This models real-world execution constraints:
 * - Latency (how long until trade executes)
 * - Slippage (price movement during execution)
 * - Partial fills (can't always fill full order)
 * - Failures (transactions can fail)
 */
export const ExecutionModelSchema = z.object({
  /**
   * Latency distribution (milliseconds)
   * p50, p90, p99 percentiles
   */
  latency: z.object({
    p50: z.number().nonnegative(),
    p90: z.number().nonnegative(),
    p99: z.number().nonnegative(),
    jitter: z.number().nonnegative().optional(), // Random jitter amount
  }),

  /**
   * Slippage model
   */
  slippage: z.object({
    /**
     * Base slippage (as fraction, e.g., 0.001 = 0.1%)
     */
    base: z.number().min(0).max(1),

    /**
     * Slippage per unit of volume (as fraction per unit)
     * Larger orders = more slippage
     */
    volumeImpact: z.number().min(0).optional(),

    /**
     * Maximum slippage cap (as fraction)
     */
    max: z.number().min(0).max(1).optional(),
  }),

  /**
   * Failure model
   */
  failures: z
    .object({
      /**
       * Base failure rate (as fraction, e.g., 0.01 = 1%)
       */
      baseRate: z.number().min(0).max(1),

      /**
       * Failure rate increases with network congestion
       */
      congestionMultiplier: z.number().min(1).optional(),
    })
    .optional(),

  /**
   * Partial fills model
   */
  partialFills: z
    .object({
      /**
       * Probability of partial fill (as fraction)
       */
      probability: z.number().min(0).max(1),

      /**
       * Distribution of fill percentage when partial
       * [min, max] as fractions (e.g., [0.5, 0.9] = 50-90% filled)
       */
      fillRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
    })
    .optional(),
});

export type ExecutionModel = z.infer<typeof ExecutionModelSchema>;

/**
 * CostModel - Fee and cost structure
 *
 * Models all costs associated with trading:
 * - Base fees (per transaction)
 * - Priority fees (for fast execution)
 * - Compute unit costs
 * - Effective cost per trade
 */
export const CostModelSchema = z.object({
  /**
   * Base transaction fee (in lamports or wei)
   */
  baseFee: z.number().nonnegative(),

  /**
   * Priority fee model (for fast execution)
   */
  priorityFee: z
    .object({
      /**
       * Base priority fee (in lamports per compute unit)
       */
      base: z.number().nonnegative(),

      /**
       * Maximum priority fee cap
       */
      max: z.number().nonnegative().optional(),
    })
    .optional(),

  /**
   * Compute unit cost (if applicable)
   */
  computeUnitCost: z.number().nonnegative().optional(),

  /**
   * Trading fee (venue-specific, as fraction, e.g., 0.01 = 1%)
   */
  tradingFee: z.number().min(0).max(1).optional(),

  /**
   * Effective cost per trade (calculated, in base currency)
   * This is the total expected cost including all fees
   */
  effectiveCostPerTrade: z.number().nonnegative().optional(),
});

export type CostModel = z.infer<typeof CostModelSchema>;

/**
 * RiskModel - Risk constraints and circuit breakers
 *
 * Defines when to stop trading:
 * - Max drawdown
 * - Max loss per day
 * - Max consecutive losses
 * - Exposure limits
 */
export const RiskModelSchema = z.object({
  /**
   * Maximum drawdown (as fraction, e.g., 0.2 = 20%)
   */
  maxDrawdown: z.number().min(0).max(1).optional(),

  /**
   * Maximum loss per day (in base currency)
   */
  maxLossPerDay: z.number().nonnegative().optional(),

  /**
   * Maximum consecutive losses before stopping
   */
  maxConsecutiveLosses: z.number().int().nonnegative().optional(),

  /**
   * Maximum position size (in base currency)
   */
  maxPositionSize: z.number().nonnegative().optional(),

  /**
   * Maximum total exposure (in base currency)
   */
  maxTotalExposure: z.number().nonnegative().optional(),

  /**
   * Trade throttling (max trades per time window)
   */
  tradeThrottle: z
    .object({
      maxTrades: z.number().int().positive(),
      windowMinutes: z.number().int().positive(),
    })
    .optional(),
});

export type RiskModel = z.infer<typeof RiskModelSchema>;

/**
 * RunConfig - Configuration for a simulation run
 *
 * Controls how the simulation executes:
 * - Time resolution
 * - Random seed (for determinism)
 * - Error handling mode
 * - Output verbosity
 */
export const RunConfigSchema = z.object({
  /**
   * Random seed for deterministic execution
   * Same seed + same inputs = same outputs
   */
  seed: z.number().int(),

  /**
   * Time resolution (milliseconds)
   * How granular the simulation clock is
   */
  timeResolutionMs: z.number().int().positive().default(1000),

  /**
   * Error handling mode
   * - 'collect': Continue on errors, collect them in results
   * - 'failFast': Stop on first error
   */
  errorMode: z.enum(['collect', 'failFast']).default('collect'),

  /**
   * Whether to include detailed event logs
   */
  includeEventLogs: z.boolean().default(true),

  /**
   * Whether to include intermediate state snapshots
   */
  includeStateSnapshots: z.boolean().default(false),

  /**
   * Maximum simulation time (milliseconds)
   * Safety limit to prevent runaway simulations
   */
  maxSimulationTimeMs: z.number().int().positive().optional(),
});

export type RunConfig = z.infer<typeof RunConfigSchema>;

/**
 * SimulationRequest - Complete input to a simulation
 *
 * This is the canonical input shape. All simulations accept this.
 */
export const SimulationRequestSchema = z.object({
  /**
   * Reference to the data snapshot to simulate on
   */
  dataSnapshot: DataSnapshotRefSchema,

  /**
   * Reference to the strategy to simulate
   */
  strategy: StrategyRefSchema,

  /**
   * Execution model (how trades execute)
   */
  executionModel: ExecutionModelSchema,

  /**
   * Cost model (fees and costs)
   */
  costModel: CostModelSchema,

  /**
   * Risk model (constraints and circuit breakers)
   */
  riskModel: RiskModelSchema.optional(),

  /**
   * Run configuration
   */
  runConfig: RunConfigSchema,
});

export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;

/**
 * Contract guarantees:
 *
 * 1. Determinism: Same inputs (including seed) = same outputs
 * 2. Replayability: Can re-run any simulation with same inputs
 * 3. Versioning: All inputs/outputs are versioned
 * 4. Immutability: Artifacts are immutable once created
 * 5. Completeness: All required metrics are always present
 */
