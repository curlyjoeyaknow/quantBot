import { z } from 'zod';

export const runSchema = z.object({
  strategy: z.string().min(1),
  caller: z.string().optional(),
  from: z.string(),
  to: z.string(),
  interval: z.enum(['1m', '5m', '15m', '1h']).default('1m'),
  preWindow: z.coerce.number().int().min(0).default(0),
  postWindow: z.coerce.number().int().min(0).default(0),
  dryRun: z.boolean().default(false),
  concurrency: z.coerce.number().int().min(1).max(64).default(8),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const listRunsSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type RunSimulationArgs = z.infer<typeof runSchema>;
export type ListRunsArgs = z.infer<typeof listRunsSchema>;

export const runSimulationDuckdbSchema = z.object({
  duckdb: z.string(),
  strategy: z.object({
    strategy_id: z.string(),
    name: z.string(),
    entry_type: z.enum(['immediate', 'drop', 'trailing']),
    profit_targets: z.array(
      z.object({
        target: z.number().positive(),
        percent: z.number().min(0).max(1),
      })
    ),
    stop_loss_pct: z.number().min(0).max(1).optional(),
    trailing_stop_pct: z.number().min(0).max(1).optional(),
    trailing_activation_pct: z.number().min(0).max(1).optional(),
    reentry_config: z.record(z.unknown()).optional(),
    maker_fee: z.number().min(0).max(1).default(0.001),
    taker_fee: z.number().min(0).max(1).default(0.001),
    slippage: z.number().min(0).max(1).default(0.005),
  }),
  mint: z.string().optional(),
  alert_timestamp: z.string().optional(),
  batch: z.boolean().default(false),
  initial_capital: z.number().positive().default(1000.0),
  lookback_minutes: z.number().int().positive().default(260),
  lookforward_minutes: z.number().int().positive().default(1440),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type RunSimulationDuckdbArgs = z.infer<typeof runSimulationDuckdbSchema>;

export const storeStrategySchema = z.object({
  duckdb: z.string().min(1),
  strategyId: z.string().min(1),
  name: z.string().min(1),
  entryConfig: z.record(z.unknown()),
  exitConfig: z.record(z.unknown()),
  reentryConfig: z.record(z.unknown()).optional(),
  costConfig: z.record(z.unknown()).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const storeRunSchema = z.object({
  duckdb: z.string().min(1),
  runId: z.string().min(1),
  strategyId: z.string().min(1),
  mint: z.string().min(1),
  alertTimestamp: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  initialCapital: z.number().positive().default(1000.0),
  finalCapital: z.number().optional(),
  totalReturnPct: z.number().optional(),
  maxDrawdownPct: z.number().optional(),
  sharpeRatio: z.number().optional(),
  winRate: z.number().optional(),
  totalTrades: z.number().int().min(0).default(0),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const generateReportSchema = z.object({
  duckdb: z.string().min(1),
  type: z.enum(['summary', 'strategy_performance']),
  strategyId: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const clickHouseQuerySchema = z.object({
  operation: z.enum(['query_ohlcv', 'store_events', 'aggregate_metrics']),
  tokenAddress: z.string().optional(),
  chain: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  interval: z.enum(['1m', '5m', '15m', '1h']).optional(),
  runId: z.string().optional(),
  events: z.array(z.record(z.unknown())).optional(),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type StoreStrategyArgs = z.infer<typeof storeStrategySchema>;
export type StoreRunArgs = z.infer<typeof storeRunSchema>;
export type GenerateReportArgs = z.infer<typeof generateReportSchema>;
export type ClickHouseQueryArgs = z.infer<typeof clickHouseQuerySchema>;
