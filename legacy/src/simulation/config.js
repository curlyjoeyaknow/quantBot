"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimulationConfigSchema = exports.ScenarioSchema = exports.RunOptionsSchema = exports.OutputTargetSchema = exports.DataSelectionSchema = exports.CostConfigSchema = exports.LadderConfigSchema = exports.LadderLegSchema = exports.SignalGroupSchema = exports.SignalConditionSchema = exports.ComparisonOperatorSchema = exports.IndicatorNameSchema = exports.ReEntryConfigSchema = exports.EntryConfigSchema = exports.StopLossConfigSchema = exports.StrategyLegSchema = void 0;
exports.parseSimulationConfig = parseSimulationConfig;
const zod_1 = require("zod");
/**
 * Shared strategy schemas reused across scenarios.
 *
 * These are intentionally richer than the legacy \"array of legs\" representation
 * used by some scripts. The engine consumes a normalized representation, while
 * full strategy configs (including ladders and indicator logic) are stored in
 * Postgres and can be rendered in the UI.
 */
exports.StrategyLegSchema = zod_1.z.object({
    target: zod_1.z.number().positive(),
    percent: zod_1.z.number().min(0).max(1),
});
exports.StopLossConfigSchema = zod_1.z.object({
    initial: zod_1.z.number().min(-0.99).max(0),
    trailing: zod_1.z.union([zod_1.z.number().min(0).max(10), zod_1.z.literal('none')]).default('none'),
});
exports.EntryConfigSchema = zod_1.z.object({
    initialEntry: zod_1.z.union([zod_1.z.number().min(-0.99).max(0), zod_1.z.literal('none')]).default('none'),
    trailingEntry: zod_1.z.union([zod_1.z.number().min(0).max(5), zod_1.z.literal('none')]).default('none'),
    maxWaitTime: zod_1.z.number().int().min(1).max(24 * 7).default(60),
});
exports.ReEntryConfigSchema = zod_1.z.object({
    trailingReEntry: zod_1.z.union([zod_1.z.number().min(0).max(0.99), zod_1.z.literal('none')]).default('none'),
    maxReEntries: zod_1.z.number().int().min(0).max(10).default(0),
    sizePercent: zod_1.z.number().min(0).max(1).default(0.5),
});
/**
 * Indicator & signal schemas
 *
 * These describe declarative conditions for entries, exits, and re-entries.
 */
exports.IndicatorNameSchema = zod_1.z.enum([
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
exports.ComparisonOperatorSchema = zod_1.z.enum([
    '>',
    '>=',
    '<',
    '<=',
    '==',
    '!=',
    'crosses_above',
    'crosses_below',
]);
exports.SignalConditionSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    indicator: exports.IndicatorNameSchema,
    /**
     * Optional secondary indicator for pairwise conditions
     * (e.g., fast EMA vs slow EMA).
     */
    secondaryIndicator: exports.IndicatorNameSchema.optional(),
    field: zod_1.z.string().default('value'),
    operator: exports.ComparisonOperatorSchema,
    /**
     * Threshold or comparison value. For cross conditions this can be omitted
     * when using a secondary indicator.
     */
    value: zod_1.z.number().optional(),
    /**
     * Lookback window for conditions like \"true in X of last N bars\".
     */
    lookbackBars: zod_1.z.number().int().min(1).max(10000).optional(),
    minBarsTrue: zod_1.z.number().int().min(1).max(10000).optional(),
});
exports.SignalGroupSchema = zod_1.z.lazy(() => zod_1.z.object({
    id: zod_1.z.string().optional(),
    logic: zod_1.z.enum(['AND', 'OR']).default('AND'),
    conditions: zod_1.z.array(exports.SignalConditionSchema).default([]),
    groups: zod_1.z.array(exports.SignalGroupSchema).default([]),
}));
exports.LadderLegSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    sizePercent: zod_1.z.number().min(0).max(1),
    /**
     * Optional absolute or relative trigger levels:
     * - priceOffset: relative to entry (e.g., -0.1 for -10% from entry)
     * - multiple: target multiple (e.g., 2 for 2x)
     */
    priceOffset: zod_1.z.number().optional(),
    multiple: zod_1.z.number().optional(),
    /**
     * Optional signal group that must be satisfied to execute this leg.
     */
    signal: exports.SignalGroupSchema.optional(),
});
exports.LadderConfigSchema = zod_1.z.object({
    /** Ordered ladder legs for entries or exits. */
    legs: zod_1.z.array(exports.LadderLegSchema).nonempty(),
    /**
     * Whether legs must be executed sequentially (true) or each leg can
     * trigger independently (false).
     */
    sequential: zod_1.z.boolean().default(true),
});
exports.CostConfigSchema = zod_1.z.object({
    entrySlippageBps: zod_1.z.number().int().min(0).max(10000).default(0),
    exitSlippageBps: zod_1.z.number().int().min(0).max(10000).default(0),
    takerFeeBps: zod_1.z.number().int().min(0).max(10000).default(25),
    borrowAprBps: zod_1.z.number().int().min(0).max(100000).default(0),
});
/**
 * Data selection schemas
 */
const MintSelectorSchema = zod_1.z.object({
    kind: zod_1.z.literal('mint'),
    mint: zod_1.z.string().min(32),
    chain: zod_1.z.string().default('solana'),
    start: zod_1.z.string().datetime(),
    end: zod_1.z.string().datetime().optional(),
    durationHours: zod_1.z.number().int().min(1).max(24 * 90).optional(),
});
const CallerSelectorSchema = zod_1.z.object({
    kind: zod_1.z.literal('caller'),
    caller: zod_1.z.string().min(1),
    chain: zod_1.z.string().default('solana'),
    limit: zod_1.z.number().int().min(1).max(500).default(50),
    lookbackDays: zod_1.z.number().int().min(1).max(365).optional(),
    includeFailed: zod_1.z.boolean().default(false),
});
const FileSelectorSchema = zod_1.z.object({
    kind: zod_1.z.literal('file'),
    path: zod_1.z.string(),
    format: zod_1.z.enum(['csv', 'json']).default('csv'),
    mintField: zod_1.z.string().default('mint'),
    chainField: zod_1.z.string().optional().default('chain'),
    timestampField: zod_1.z.string().default('timestamp'),
    startOffsetMinutes: zod_1.z.number().int().min(0).optional().default(0),
    durationHours: zod_1.z.number().int().min(1).max(24 * 90).optional().default(24),
    filter: zod_1.z.record(zod_1.z.string(), zod_1.z.any()).optional(),
});
const DatasetSelectorSchema = zod_1.z.object({
    kind: zod_1.z.literal('dataset'),
    id: zod_1.z.string(),
});
exports.DataSelectionSchema = zod_1.z.discriminatedUnion('kind', [
    MintSelectorSchema,
    CallerSelectorSchema,
    FileSelectorSchema,
    DatasetSelectorSchema,
]);
/**
 * Output target schemas
 */
const StdoutSinkSchema = zod_1.z.object({
    type: zod_1.z.literal('stdout'),
    detail: zod_1.z.enum(['summary', 'detailed']).default('summary'),
});
const CsvSinkSchema = zod_1.z.object({
    type: zod_1.z.literal('csv'),
    path: zod_1.z.string(),
    includeEvents: zod_1.z.boolean().default(false),
    append: zod_1.z.boolean().default(false),
});
const JsonSinkSchema = zod_1.z.object({
    type: zod_1.z.literal('json'),
    path: zod_1.z.string(),
    pretty: zod_1.z.boolean().default(true),
    includeEvents: zod_1.z.boolean().default(true),
});
const ClickHouseSinkSchema = zod_1.z.object({
    type: zod_1.z.literal('clickhouse'),
    table: zod_1.z.string().default('simulation_results'),
    schema: zod_1.z.enum(['aggregate', 'expanded']).default('aggregate'),
    upsert: zod_1.z.boolean().default(false),
});
exports.OutputTargetSchema = zod_1.z.discriminatedUnion('type', [
    StdoutSinkSchema,
    CsvSinkSchema,
    JsonSinkSchema,
    ClickHouseSinkSchema,
]);
/**
 * Scenario + run option schemas
 */
exports.RunOptionsSchema = zod_1.z.object({
    maxConcurrency: zod_1.z.number().int().min(1).max(64).default(4),
    cachePolicy: zod_1.z.enum(['prefer-cache', 'refresh', 'cache-only']).default('prefer-cache'),
    dryRun: zod_1.z.boolean().default(false),
    failFast: zod_1.z.boolean().default(true),
    progressInterval: zod_1.z.number().int().min(1).max(10000).default(100),
});
exports.ScenarioSchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
    name: zod_1.z.string(),
    tags: zod_1.z.array(zod_1.z.string()).default([]),
    data: exports.DataSelectionSchema,
    /**
     * Legacy profit target representation (kept for backwards compatibility).
     * New strategies should prefer `entryLadder` / `exitLadder` with
     * indicator-driven `SignalGroup` conditions.
     */
    strategy: zod_1.z.array(exports.StrategyLegSchema).nonempty(),
    stopLoss: exports.StopLossConfigSchema.optional(),
    entry: exports.EntryConfigSchema.optional(),
    reEntry: exports.ReEntryConfigSchema.optional(),
    costs: exports.CostConfigSchema.optional(),
    /**
     * Optional declarative entry/exit signal definitions. When present, the
     * engine should prefer these over simple price-only rules.
     */
    entrySignal: exports.SignalGroupSchema.optional(),
    exitSignal: exports.SignalGroupSchema.optional(),
    /**
     * Laddered entries and exits. These allow partial fills and staggered
     * exits, each gated by price levels and/or indicator signals.
     */
    entryLadder: exports.LadderConfigSchema.optional(),
    exitLadder: exports.LadderConfigSchema.optional(),
    outputs: zod_1.z.array(exports.OutputTargetSchema).optional(),
    notes: zod_1.z.string().optional(),
});
exports.SimulationConfigSchema = zod_1.z.object({
    version: zod_1.z.string().default('1'),
    global: zod_1.z
        .object({
        defaults: zod_1.z
            .object({
            stopLoss: exports.StopLossConfigSchema.optional(),
            entry: exports.EntryConfigSchema.optional(),
            reEntry: exports.ReEntryConfigSchema.optional(),
            costs: exports.CostConfigSchema.optional(),
            outputs: zod_1.z.array(exports.OutputTargetSchema).optional(),
        })
            .default({}),
        run: exports.RunOptionsSchema.optional(),
    })
        .default({ defaults: {}, run: exports.RunOptionsSchema.parse({}) }),
    scenarios: zod_1.z.array(exports.ScenarioSchema).nonempty(),
});
function parseSimulationConfig(input) {
    return exports.SimulationConfigSchema.parse(input);
}
//# sourceMappingURL=config.js.map