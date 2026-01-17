/**
 * Risk Policy Types (Phase 4 - MVP 2)
 *
 * Guardrail 3: Policy Execution Replays Candles
 * - Policy execution needs candle stream to know what would have triggered when
 * - Path metrics are for evaluation only
 *
 * Policy primitives:
 * - Fixed stop: exit if price drops below stop level
 * - Time stop: exit after max hold time
 * - Trailing stop: trail price with activation threshold
 * - Ladder: partial exits at multiple levels
 * - Combo: combine multiple policies
 */

import { z } from 'zod';

// =============================================================================
// Policy Type Definitions
// =============================================================================

/**
 * Fixed stop-loss policy
 * Exit if price drops below (entry * (1 - stopPct))
 */
export interface FixedStopPolicy {
  kind: 'fixed_stop';
  /** Stop loss percentage (e.g., 0.20 = 20% loss triggers stop) */
  stopPct: number;
  /** Optional take profit percentage (e.g., 1.0 = 100% gain triggers exit) */
  takeProfitPct?: number;
}

/**
 * Time stop policy
 * Exit after maxHoldMs milliseconds
 */
export interface TimeStopPolicy {
  kind: 'time_stop';
  /** Maximum hold time in milliseconds */
  maxHoldMs: number;
  /** Optional take profit percentage */
  takeProfitPct?: number;
}

/**
 * Trailing stop policy
 * Trail price after activation threshold, exit if price drops by trailPct from peak
 */
export interface TrailingStopPolicy {
  kind: 'trailing_stop';
  /** Activation threshold (e.g., 0.20 = activate after 20% gain) */
  activationPct: number;
  /** Trail percentage from peak (e.g., 0.10 = exit if drops 10% from peak) */
  trailPct: number;
  /** Optional hard stop (always active, independent of trailing) */
  hardStopPct?: number;
}

/**
 * Ladder exit policy
 * Partial exits at multiple price levels
 */
export interface LadderPolicy {
  kind: 'ladder';
  /** Exit levels - multiple (e.g., 2x) and fraction to exit */
  levels: Array<{
    /** Price multiple (e.g., 2.0 = 2x entry price) */
    multiple: number;
    /** Fraction of position to exit (e.g., 0.5 = 50%) */
    fraction: number;
  }>;
  /** Optional stop loss for remaining position */
  stopPct?: number;
}

/**
 * Combo policy
 * Combine multiple policies (first trigger wins)
 */
export interface ComboPolicy {
  kind: 'combo';
  /** Policies to combine (first to trigger exits) */
  policies: RiskPolicy[];
}

/**
 * Wash-and-rebound policy
 *
 * 3-state machine:
 * - IN_POSITION: Track peak, exit on 20% trailing stop from peak
 * - WAIT_FOR_WASH: Wait for 50% drop from peak_at_exit
 * - WAIT_FOR_REBOUND: Wait for 20% rebound from wash_low, then re-enter
 *
 * Deterministic 1m execution:
 * - Exit fill = peak * 0.80 (stop price)
 * - Re-entry fill = wash_low * 1.20 (trigger price)
 * - Wick-aware (uses candle.high and candle.low)
 */
export interface WashReboundPolicy {
  kind: 'wash_rebound';
  /** Trail percentage from peak (e.g., 0.20 = exit if drops 20% from peak) */
  trailPct: number;
  /** Wash threshold (e.g., 0.50 = 50% drop from peak_at_exit triggers wash state) */
  washPct: number;
  /** Rebound threshold (e.g., 0.20 = 20% rebound from wash_low triggers re-entry) */
  reboundPct: number;
  /** Maximum re-entries per token (prevents infinite churn) */
  maxReentries?: number;
  /** Cooldown candles after exit before allowing re-entry (reduces whipsaw) */
  cooldownCandles?: number;
}

/**
 * Union type for all risk policies
 */
export type RiskPolicy =
  | FixedStopPolicy
  | TimeStopPolicy
  | TrailingStopPolicy
  | LadderPolicy
  | ComboPolicy
  | WashReboundPolicy;

// =============================================================================
// Zod Schemas for Validation
// =============================================================================

const fixedStopSchema = z.object({
  kind: z.literal('fixed_stop'),
  stopPct: z.number().min(0).max(1),
  takeProfitPct: z.number().min(0).optional(),
});

const timeStopSchema = z.object({
  kind: z.literal('time_stop'),
  maxHoldMs: z.number().int().positive(),
  takeProfitPct: z.number().min(0).optional(),
});

const trailingStopSchema = z.object({
  kind: z.literal('trailing_stop'),
  activationPct: z.number().min(0),
  trailPct: z.number().min(0).max(1),
  hardStopPct: z.number().min(0).max(1).optional(),
});

const ladderLevelSchema = z.object({
  multiple: z.number().positive(),
  fraction: z.number().min(0).max(1),
});

const ladderSchema = z.object({
  kind: z.literal('ladder'),
  levels: z.array(ladderLevelSchema).min(1),
  stopPct: z.number().min(0).max(1).optional(),
});

const washReboundSchema = z.object({
  kind: z.literal('wash_rebound'),
  trailPct: z.number().min(0).max(1),
  washPct: z.number().min(0).max(1),
  reboundPct: z.number().min(0).max(1),
  maxReentries: z.number().int().nonnegative().optional(),
  cooldownCandles: z.number().int().nonnegative().optional(),
});

// Forward declaration for recursive type
const basePolicySchema: z.ZodType<RiskPolicy> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    fixedStopSchema,
    timeStopSchema,
    trailingStopSchema,
    ladderSchema,
    washReboundSchema,
    z.object({
      kind: z.literal('combo'),
      policies: z.array(basePolicySchema).min(1),
    }),
  ])
);

export const riskPolicySchema = basePolicySchema;

/**
 * Parse and validate a risk policy from JSON
 */
export function parseRiskPolicy(json: unknown): RiskPolicy {
  return riskPolicySchema.parse(json);
}

// =============================================================================
// Policy Execution Result
// =============================================================================

/**
 * Result from executing a policy against a candle stream
 */
export interface PolicyExecutionResult {
  /** Realized return in basis points */
  realizedReturnBps: number;
  /** Whether position was stopped out */
  stopOut: boolean;
  /** Maximum adverse excursion (worst drawdown during trade) in bps */
  maxAdverseExcursionBps: number;
  /** Time exposed in milliseconds */
  timeExposedMs: number;
  /** Tail capture: realized return / peak possible return (0-1) */
  tailCapture: number | null;
  /** Entry timestamp (ms) */
  entryTsMs: number;
  /** Exit timestamp (ms) */
  exitTsMs: number;
  /** Entry price */
  entryPx: number;
  /** Exit price */
  exitPx: number;
  /** Exit reason */
  exitReason: string;
}

// =============================================================================
// Default Policy Configurations
// =============================================================================

/**
 * Conservative fixed stop (20% stop, 100% take profit)
 */
export const DEFAULT_FIXED_STOP: FixedStopPolicy = {
  kind: 'fixed_stop',
  stopPct: 0.2,
  takeProfitPct: 1.0,
};

/**
 * Default time stop (1 hour max hold)
 */
export const DEFAULT_TIME_STOP: TimeStopPolicy = {
  kind: 'time_stop',
  maxHoldMs: 60 * 60 * 1000, // 1 hour
};

/**
 * Default trailing stop (activate at 20% gain, trail 10%)
 */
export const DEFAULT_TRAILING_STOP: TrailingStopPolicy = {
  kind: 'trailing_stop',
  activationPct: 0.2,
  trailPct: 0.1,
  hardStopPct: 0.2,
};

/**
 * Default ladder (2x: 50%, 3x: 30%, 4x: 20%)
 */
export const DEFAULT_LADDER: LadderPolicy = {
  kind: 'ladder',
  levels: [
    { multiple: 2.0, fraction: 0.5 },
    { multiple: 3.0, fraction: 0.3 },
    { multiple: 4.0, fraction: 0.2 },
  ],
  stopPct: 0.2,
};

/**
 * Grid search parameter space for policy optimization
 */
export const POLICY_GRID = {
  fixedStop: {
    stopPct: [0.05, 0.1, 0.15, 0.2, 0.25],
    takeProfitPct: [0.5, 1.0, 1.5, 2.0, undefined],
  },
  timeStop: {
    maxHoldMs: [
      5 * 60 * 1000, // 5 min
      10 * 60 * 1000, // 10 min
      15 * 60 * 1000, // 15 min
      30 * 60 * 1000, // 30 min
      60 * 60 * 1000, // 1 hour
      2 * 60 * 60 * 1000, // 2 hours
      4 * 60 * 60 * 1000, // 4 hours
      48 * 60 * 60 * 1000, // 48 hours (full horizon)
    ],
  },
  trailingStop: {
    activationPct: [0.1, 0.2, 0.5],
    trailPct: [0.02, 0.05, 0.1],
    hardStopPct: [0.1, 0.15, 0.2],
  },
  ladder: {
    // Pre-defined ladder configurations
    configs: [
      [
        { multiple: 2.0, fraction: 0.5 },
        { multiple: 3.0, fraction: 0.3 },
        { multiple: 4.0, fraction: 0.2 },
      ],
      [
        { multiple: 1.5, fraction: 0.5 },
        { multiple: 2.0, fraction: 0.5 },
      ],
      [{ multiple: 2.0, fraction: 1.0 }],
    ],
  },
};
