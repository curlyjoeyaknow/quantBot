import { z } from 'zod';

/**
 * Shared strategy schemas reused across scenarios.
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
  maxWaitTime: z.number().int().min(1).max(24 * 7).default(60),
});

export type EntryConfig = z.infer<typeof EntryConfigSchema>;

export const ReEntryConfigSchema = z.object({
  trailingReEntry: z.union([z.number().min(0).max(0.99), z.literal('none')]).default('none'),
  maxReEntries: z.number().int().min(0).max(10).default(0),
  sizePercent: z.number().min(0).max(1).default(0.5),
});

export type ReEntryConfig = z.infer<typeof ReEntryConfigSchema>;

export const CostConfigSchema = z.object({
  entrySlippageBps: z.number().int().min(0).max(10_000).default(0),
  exitSlippageBps: z.number().int().min(0).max(10_000).default(0),
  takerFeeBps: z.number().int().min(0).max(10_000).default(25),
  borrowAprBps: z.number().int().min(0).max(100_000).default(0),
});

export type CostConfig = z.infer<typeof CostConfigSchema>;

/**
 * Data selection schemas
 */
const MintSelectorSchema = z.object({
  kind: z.literal('mint'),
  mint: z.string().min(32),
  chain: z.string().default('solana'),
  start: z.string().datetime(),
  end: z.string().datetime().optional(),
  durationHours: z.number().int().min(1).max(24 * 90).optional(),
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
  durationHours: z.number().int().min(1).max(24 * 90).optional().default(24),
  filter: z.record(z.string(), z.any()).optional(),
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
  strategy: z.array(StrategyLegSchema).nonempty(),
  stopLoss: StopLossConfigSchema.optional(),
  entry: EntryConfigSchema.optional(),
  reEntry: ReEntryConfigSchema.optional(),
  costs: CostConfigSchema.optional(),
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

