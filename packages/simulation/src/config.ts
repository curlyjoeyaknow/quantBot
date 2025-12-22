import { z } from 'zod';

/**
 * Shared strategy schemas reused across scenarios.
 *
 * These are intentionally richer than the legacy \"array of legs\" representation
 * used by some scripts. The engine consumes a normalized representation, while
 * full strategy configs (including ladders and indicator logic) are stored in
 * Postgres and can be rendered in the UI.
 */

export const StrategyLegSchema = z.object({
  target: z.number().positive(),
  percent: z.number().min(0).max(1),
});

export type StrategyLeg = z.infer<typeof StrategyLegSchema>;

export const StopLossConfigSchema = z.object({
  initial: z.number().min(-0.99).max(0),
  trailing: z.union([z.number().min(0).max(10), z.literal('none')]).default('none'),
});

export type StopLossConfig = z.infer<typeof StopLossConfigSchema>;

export const EntryConfigSchema = z.object({
  initialEntry: z.union([z.number().min(-0.99).max(0), z.literal('none')]).default('none'),
  trailingEntry: z.union([z.number().min(0).max(5), z.literal('none')]).default('none'),
  maxWaitTime: z
    .number()
    .int()
    .min(1)
    .max(24 * 7)
    .default(60),
});

export type EntryConfig = z.infer<typeof EntryConfigSchema>;

export const ReEntryConfigSchema = z.object({
  trailingReEntry: z.union([z.number().min(0).max(0.99), z.literal('none')]).default('none'),
  maxReEntries: z.number().int().min(0).max(10).default(0),
  sizePercent: z.number().min(0).max(1).default(0.5),
});

export type ReEntryConfig = z.infer<typeof ReEntryConfigSchema>;

/**
 * Indicator & signal schemas
 *
 * These describe declarative conditions for entries, exits, and re-entries.
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

export const SignalConditionSchema = z.object({
  id: z.string().optional(),
  indicator: IndicatorNameSchema,
  /**
   * Optional secondary indicator for pairwise conditions
   * (e.g., fast EMA vs slow EMA).
   */
  secondaryIndicator: IndicatorNameSchema.optional(),
  field: z.string().default('value'),
  operator: ComparisonOperatorSchema,
  /**
   * Threshold or comparison value. For cross conditions this can be omitted
   * when using a secondary indicator.
   */
  value: z.number().optional(),
  /**
   * Lookback window for conditions like \"true in X of last N bars\".
   */
  lookbackBars: z.number().int().min(1).max(10_000).optional(),
  minBarsTrue: z.number().int().min(1).max(10_000).optional(),
});

export type SignalCondition = z.infer<typeof SignalConditionSchema>;

// Forward declaration for recursive type
export interface SignalGroup {
  id?: string;
  logic?: 'AND' | 'OR';
  conditions?: SignalCondition[];
  groups?: SignalGroup[];
}

export const SignalGroupSchema: z.ZodType<SignalGroup> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    logic: z.enum(['AND', 'OR']).default('AND'),
    conditions: z.array(SignalConditionSchema).default([]),
    groups: z.array(SignalGroupSchema).default([]),
  })
);

export const LadderLegSchema = z.object({
  id: z.string().optional(),
  sizePercent: z.number().min(0).max(1),
  /**
   * Optional absolute or relative trigger levels:
   * - priceOffset: relative to entry (e.g., -0.1 for -10% from entry)
   * - multiple: target multiple (e.g., 2 for 2x)
   */
  priceOffset: z.number().optional(),
  multiple: z.number().optional(),
  /**
   * Optional signal group that must be satisfied to execute this leg.
   */
  signal: SignalGroupSchema.optional(),
});

export type LadderLeg = z.infer<typeof LadderLegSchema>;

export const LadderConfigSchema = z.object({
  /** Ordered ladder legs for entries or exits. */
  legs: z.array(LadderLegSchema).nonempty(),
  /**
   * Whether legs must be executed sequentially (true) or each leg can
   * trigger independently (false).
   */
  sequential: z.boolean().default(true),
});

export type LadderConfig = z.infer<typeof LadderConfigSchema>;

export const CostConfigSchema = z.object({
  entrySlippageBps: z.number().int().min(0).max(10_000).default(0),
  exitSlippageBps: z.number().int().min(0).max(10_000).default(0),
  takerFeeBps: z.number().int().min(0).max(10_000).default(25),
  borrowAprBps: z.number().int().min(0).max(100_000).default(0),
});

export type CostConfig = z.infer<typeof CostConfigSchema>;

/**
 * Period metrics configuration for re-entry analysis
 */
export const PeriodMetricsConfigSchema = z.object({
  /** Enable period metrics calculation */
  enabled: z.boolean().default(false),
  /** Analysis period in days */
  periodDays: z.number().int().min(1).max(90).default(7),
  /** Minimum drawdown percentage to consider for re-entry */
  minDrawdownPercent: z.number().min(0).max(100).default(20),
  /** Minimum recovery percentage to mark as successful re-entry */
  minRecoveryPercent: z.number().min(0).max(100).default(10),
});

export type PeriodMetricsConfig = z.infer<typeof PeriodMetricsConfigSchema>;

/**
 * Data selection schemas
 */
const MintSelectorSchema = z.object({
  kind: z.literal('mint'),
  mint: z.string().min(32),
  chain: z.string().default('solana'),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  durationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .optional(),
});

const CallerSelectorSchema = z.object({
  kind: z.literal('caller'),
  caller: z.string().min(1),
  chain: z.string().default('solana'),
  limit: z.number().int().min(1).max(500).default(50),
  lookbackDays: z.number().int().min(1).max(365).optional(),
  includeFailed: z.boolean().default(false),
});

const FileSelectorSchema = z.object({
  kind: z.literal('file'),
  path: z.string(),
  format: z.enum(['csv', 'json']).default('csv'),
  mintField: z.string().default('mint'),
  chainField: z.string().optional().default('chain'),
  timestampField: z.string().default('timestamp'),
  startOffsetMinutes: z.number().int().min(0).optional().default(0),
  durationHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .optional()
    .default(24),
  filter: z.record(z.string(), z.unknown()).optional(),
});

const DatasetSelectorSchema = z.object({
  kind: z.literal('dataset'),
  id: z.string(),
});

export const DataSelectionSchema = z.discriminatedUnion('kind', [
  MintSelectorSchema,
  CallerSelectorSchema,
  FileSelectorSchema,
  DatasetSelectorSchema,
]);

export type DataSelectionConfig = z.infer<typeof DataSelectionSchema>;

/**
 * Output target schemas
 */
const StdoutSinkSchema = z.object({
  type: z.literal('stdout'),
  detail: z.enum(['summary', 'detailed']).default('summary'),
});

const CsvSinkSchema = z.object({
  type: z.literal('csv'),
  path: z.string(),
  includeEvents: z.boolean().default(false),
  append: z.boolean().default(false),
});

const JsonSinkSchema = z.object({
  type: z.literal('json'),
  path: z.string(),
  pretty: z.boolean().default(true),
  includeEvents: z.boolean().default(true),
});

const ClickHouseSinkSchema = z.object({
  type: z.literal('clickhouse'),
  table: z.string().default('simulation_results'),
  schema: z.enum(['aggregate', 'expanded']).default('aggregate'),
  upsert: z.boolean().default(false),
});

export const OutputTargetSchema = z.discriminatedUnion('type', [
  StdoutSinkSchema,
  CsvSinkSchema,
  JsonSinkSchema,
  ClickHouseSinkSchema,
]);

export type OutputTargetConfig = z.infer<typeof OutputTargetSchema>;

/**
 * Scenario + run option schemas
 */
export const RunOptionsSchema = z.object({
  maxConcurrency: z.number().int().min(1).max(64).default(4),
  cachePolicy: z.enum(['prefer-cache', 'refresh', 'cache-only']).default('prefer-cache'),
  dryRun: z.boolean().default(false),
  failFast: z.boolean().default(true),
  progressInterval: z.number().int().min(1).max(10_000).default(100),
});

export type RunOptions = z.infer<typeof RunOptionsSchema>;

export const ScenarioSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  tags: z.array(z.string()).default([]),
  data: DataSelectionSchema,
  /**
   * Legacy profit target representation (kept for backwards compatibility).
   * New strategies should prefer `entryLadder` / `exitLadder` with
   * indicator-driven `SignalGroup` conditions.
   */
  strategy: z.array(StrategyLegSchema).nonempty(),
  stopLoss: StopLossConfigSchema.optional(),
  entry: EntryConfigSchema.optional(),
  reEntry: ReEntryConfigSchema.optional(),
  costs: CostConfigSchema.optional(),
  /**
   * Optional declarative entry/exit signal definitions. When present, the
   * engine should prefer these over simple price-only rules.
   */
  entrySignal: SignalGroupSchema.optional(),
  exitSignal: SignalGroupSchema.optional(),
  /**
   * Laddered entries and exits. These allow partial fills and staggered
   * exits, each gated by price levels and/or indicator signals.
   */
  entryLadder: LadderConfigSchema.optional(),
  exitLadder: LadderConfigSchema.optional(),
  /**
   * Period metrics configuration for re-entry strategy analysis
   */
  periodMetrics: PeriodMetricsConfigSchema.optional(),
  outputs: z.array(OutputTargetSchema).optional(),
  notes: z.string().optional(),
});

export type SimulationScenarioConfig = z.infer<typeof ScenarioSchema>;

export const SimulationConfigSchema = z.object({
  version: z.string().default('1'),
  global: z
    .object({
      defaults: z
        .object({
          stopLoss: StopLossConfigSchema.optional(),
          entry: EntryConfigSchema.optional(),
          reEntry: ReEntryConfigSchema.optional(),
          costs: CostConfigSchema.optional(),
          periodMetrics: PeriodMetricsConfigSchema.optional(),
          outputs: z.array(OutputTargetSchema).optional(),
        })
        .default({}),
      run: RunOptionsSchema.optional(),
    })
    .default({ defaults: {}, run: RunOptionsSchema.parse({}) }),
  scenarios: z.array(ScenarioSchema).nonempty(),
});

export type SimulationEngineConfig = z.infer<typeof SimulationConfigSchema>;

export function parseSimulationConfig(input: unknown): SimulationEngineConfig {
  return SimulationConfigSchema.parse(input);
}
