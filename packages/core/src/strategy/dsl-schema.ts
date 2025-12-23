/**
 * Strategy DSL Schema
 *
 * Defines a complete, structured DSL for trading strategies.
 * All strategies are data, not code - enabling mutation, comparison, and optimization.
 */

import { z } from 'zod';

/**
 * DSL Version
 */
export const DSL_VERSION = '1.0.0';

/**
 * Indicator name type
 */
export const IndicatorNameSchema = z.enum([
  'rsi',
  'macd',
  'sma',
  'ema',
  'vwma',
  'bbands',
  'atr',
  'ichimoku_cloud',
  'price_change',
  'volume_change',
  'custom',
]);

export type IndicatorName = z.infer<typeof IndicatorNameSchema>;

/**
 * Comparison operator
 */
export const ComparisonOperatorSchema = z.enum([
  '>',
  '>=',
  '<',
  '<=',
  '==',
  '!=',
  'crosses_above',
  'crosses_below',
]);

export type ComparisonOperator = z.infer<typeof ComparisonOperatorSchema>;

/**
 * Signal condition schema
 */
export const SignalConditionSchema = z.object({
  id: z.string().optional(),
  indicator: IndicatorNameSchema,
  secondaryIndicator: IndicatorNameSchema.optional(),
  field: z.string().optional(),
  operator: ComparisonOperatorSchema,
  value: z.number().optional(),
  lookbackBars: z.number().int().positive().optional(),
  minBarsTrue: z.number().int().nonnegative().optional(),
});

export type SignalCondition = z.infer<typeof SignalConditionSchema>;

/**
 * Signal group schema (recursive)
 */
export const SignalGroupSchema: z.ZodType<SignalGroup> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    logic: z.enum(['AND', 'OR']),
    conditions: z.array(SignalConditionSchema),
    groups: z.array(SignalGroupSchema).optional(),
  })
);

export interface SignalGroup {
  id?: string;
  logic: 'AND' | 'OR';
  conditions: SignalCondition[];
  groups?: SignalGroup[];
}

/**
 * Position sizing strategy
 */
export const PositionSizingSchema = z.object({
  type: z.enum(['fixed', 'percent_of_capital', 'risk_based', 'kelly']),
  /** For fixed: absolute amount, for percent: 0-1, for risk: max risk % */
  value: z.number().positive(),
  /** Maximum position size (optional cap) */
  maxSize: z.number().positive().optional(),
});

export type PositionSizing = z.infer<typeof PositionSizingSchema>;

/**
 * Entry condition schema
 */
export const EntryConditionSchema = z.object({
  /** Type of entry: immediate, price_drop, trailing_rebound, signal */
  type: z.enum(['immediate', 'price_drop', 'trailing_rebound', 'signal']),
  /** For price_drop: wait for X% drop (negative value, e.g., -0.3 for 30%) */
  priceDropPercent: z.number().negative().optional(),
  /** For trailing_rebound: wait for X% rebound from low */
  reboundPercent: z.number().positive().optional(),
  /** For signal: use indicator-based signals */
  signal: SignalGroupSchema.optional(),
  /** Maximum wait time in minutes */
  maxWaitMinutes: z.number().int().positive().optional(),
});

export type EntryCondition = z.infer<typeof EntryConditionSchema>;

/**
 * Exit condition schema
 */
export const ExitConditionSchema = z.object({
  /** Type of exit: profit_target, stop_loss, signal, time, ladder */
  type: z.enum(['profit_target', 'stop_loss', 'signal', 'time', 'ladder']),
  /** For profit_target: multiplier (e.g., 2.0 for 2x) */
  profitTarget: z.number().positive().optional(),
  /** For profit_target: percent of position to exit (0-1) */
  percentToExit: z.number().min(0).max(1).optional(),
  /** For stop_loss: loss as fraction (e.g., -0.3 for -30%) */
  stopLossPercent: z.number().negative().optional(),
  /** For stop_loss: trailing activation threshold (multiplier) */
  trailingStopThreshold: z.number().positive().optional(),
  /** For stop_loss: trailing stop percent (e.g., 0.25 for 25%) */
  trailingStopPercent: z.number().positive().optional(),
  /** For signal: use indicator-based signals */
  signal: SignalGroupSchema.optional(),
  /** For time: hold duration in hours */
  holdHours: z.number().positive().optional(),
  /** For ladder: ladder configuration */
  ladder: z
    .object({
      legs: z.array(
        z.object({
          id: z.string().optional(),
          sizePercent: z.number().min(0).max(1),
          priceOffset: z.number().optional(),
          multiple: z.number().positive().optional(),
          signal: SignalGroupSchema.optional(),
        })
      ),
      sequential: z.boolean().optional(),
    })
    .optional(),
});

export type ExitCondition = z.infer<typeof ExitConditionSchema>;

/**
 * Re-entry condition schema
 */
export const ReEntryConditionSchema = z.object({
  /** Enabled: allow re-entries */
  enabled: z.boolean(),
  /** Type: trailing_retrace, signal */
  type: z.enum(['trailing_retrace', 'signal']).optional(),
  /** For trailing_retrace: percent retrace from peak (e.g., 0.5 for 50%) */
  retracePercent: z.number().positive().optional(),
  /** For signal: use indicator-based signals */
  signal: SignalGroupSchema.optional(),
  /** Maximum number of re-entries */
  maxReEntries: z.number().int().nonnegative().optional(),
  /** Size of re-entry as fraction of original position (0-1) */
  sizePercent: z.number().min(0).max(1).optional(),
});

export type ReEntryCondition = z.infer<typeof ReEntryConditionSchema>;

/**
 * Risk constraints schema
 */
export const RiskConstraintsSchema = z.object({
  /** Maximum loss as fraction (e.g., 0.2 for -20% max) */
  maxLossPercent: z.number().negative().optional(),
  /** Minimum exit price as fraction of entry (e.g., 0.5 for never sell below 50% of entry) */
  minExitPrice: z.number().min(0).max(1).optional(),
  /** Maximum position size */
  maxPositionSize: z.number().positive().optional(),
  /** Maximum leverage (if applicable) */
  maxLeverage: z.number().positive().optional(),
});

export type RiskConstraints = z.infer<typeof RiskConstraintsSchema>;

/**
 * Cost configuration schema
 */
export const CostConfigSchema = z.object({
  /** Entry slippage in basis points (e.g., 50 for 0.5%) */
  entrySlippageBps: z.number().nonnegative().optional(),
  /** Exit slippage in basis points */
  exitSlippageBps: z.number().nonnegative().optional(),
  /** Transaction fee as fraction (e.g., 0.001 for 0.1%) */
  feePercent: z.number().nonnegative().optional(),
  /** Fixed fee per transaction */
  fixedFee: z.number().nonnegative().optional(),
});

export type CostConfig = z.infer<typeof CostConfigSchema>;

/**
 * Complete Strategy DSL Schema
 */
export const StrategyDSLSchema = z.object({
  /** DSL version */
  version: z.string().default(DSL_VERSION),
  /** Strategy identifier */
  id: z.string().optional(),
  /** Strategy name */
  name: z.string().min(1),
  /** Strategy description */
  description: z.string().optional(),
  /** Strategy tags for categorization */
  tags: z.array(z.string()).default([]),
  /** Position sizing configuration */
  positionSizing: PositionSizingSchema.optional(),
  /** Entry conditions */
  entry: EntryConditionSchema,
  /** Exit conditions (array for multiple exits) */
  exit: z.array(ExitConditionSchema).min(1),
  /** Re-entry conditions */
  reEntry: ReEntryConditionSchema.optional(),
  /** Risk constraints */
  risk: RiskConstraintsSchema.optional(),
  /** Cost configuration */
  costs: CostConfigSchema.optional(),
  /** Metadata (free-form) */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type StrategyDSL = z.infer<typeof StrategyDSLSchema>;

/**
 * Validate Strategy DSL
 */
export function validateStrategyDSL(dsl: unknown): { valid: boolean; errors: string[] } {
  const result = StrategyDSLSchema.safeParse(dsl);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });

  return { valid: false, errors };
}

/**
 * Parse Strategy DSL from JSON
 */
export function parseStrategyDSL(json: string | Record<string, unknown>): StrategyDSL {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  return StrategyDSLSchema.parse(data);
}
