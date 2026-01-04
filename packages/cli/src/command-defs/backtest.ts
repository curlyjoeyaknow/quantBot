import { z } from 'zod';

/**
 * Backtest run schema
 *
 * Strategy modes:
 * - path-only: Guardrail 2 - compute path metrics only, no trades
 * - exit-optimizer: Original mode with exit overlays
 * - exit-stack: Exit stack mode with strategy_id from DuckDB
 */
export const backtestRunSchema = z.object({
  // Strategy mode: path-only (truth layer), exit-optimizer, or exit-stack
  strategy: z.enum(['path-only', 'exit-optimizer', 'exit-stack']),
  strategyId: z.string().optional(), // DuckDB strategy_id (required for exit-stack)
  runId: z.string().optional(), // Run ID (provided by Lab UI, optional for backward compat)
  filter: z.string().optional(),
  interval: z.string().min(1),
  from: z.string(),
  to: z.string(),
  // Fees/position only needed for non-path-only modes
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30),
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10),
  positionUsd: z.coerce.number().positive().default(1000),
  includeReplay: z.boolean().default(false),
  // Path-only specific options
  activityMovePct: z.coerce.number().min(0).max(1).default(0.1), // Default 10%
});

export type BacktestRunArgs = z.infer<typeof backtestRunSchema>;

export const backtestCallersSchema = z.object({
  runId: z.string().min(1),
  sort: z
    .enum([
      'calls',
      'count_2x',
      'count_3x',
      'count_4x',
      'p_hit_2x',
      'p_hit_3x',
      'p_hit_4x',
      'avg_peak_multiple',
    ])
    .optional()
    .default('count_4x'),
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestCallersArgs = z.infer<typeof backtestCallersSchema>;

export const backtestListSchema = z.object({
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestListArgs = z.infer<typeof backtestListSchema>;

export const backtestLeaderboardSchema = z.object({
  runId: z.string().optional(),
  minCalls: z.coerce.number().int().min(0).default(20),
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestLeaderboardArgs = z.infer<typeof backtestLeaderboardSchema>;

/**
 * Truth leaderboard schema (Phase 3 - MVP 1)
 * Shows caller leaderboard from path metrics only (no policy data)
 */
export const backtestTruthLeaderboardSchema = z.object({
  runId: z.string().min(1),
  minCalls: z.coerce.number().int().min(0).default(0),
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestTruthLeaderboardArgs = z.infer<typeof backtestTruthLeaderboardSchema>;

/**
 * Policy backtest schema (Phase 4 - MVP 2)
 * Execute a risk policy against calls with candle replay
 */
export const backtestPolicySchema = z.object({
  policyJson: z.string().min(1), // JSON string of RiskPolicy
  policyId: z.string().optional(), // Will be auto-generated if not provided
  filter: z.string().optional(), // Caller name filter
  interval: z.string().min(1),
  from: z.string(),
  to: z.string(),
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30),
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10),
  runId: z.string().optional(), // Optional existing run ID
  format: z.enum(['json', 'table', 'csv']).optional().default('json'),
});

export type BacktestPolicyArgs = z.infer<typeof backtestPolicySchema>;

/**
 * Optimize schema (Phase 5 - MVP 3)
 * Grid search to find optimal policy for a caller
 */
export const backtestOptimizeSchema = z.object({
  caller: z.string().optional(), // Optional caller filter (if not provided, optimize for all)
  interval: z.string().min(1),
  from: z.string(),
  to: z.string(),
  // Constraints
  maxStopOutRate: z.coerce.number().min(0).max(1).default(0.3),
  maxP95DrawdownBps: z.coerce.number().max(0).default(-3000),
  maxTimeExposedMs: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 60 * 60 * 1000),
  // Fees
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30),
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10),
  // Output
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),
});

export type BacktestOptimizeArgs = z.infer<typeof backtestOptimizeSchema>;

/**
 * Baseline backtest schema
 *
 * Per-alert backtest computing:
 * - ATH multiple after alert
 * - Max drawdown after alert
 * - Max drawdown before first 2x
 * - Time-to-2x
 * - Simple TP/SL exit policy returns
 */
export const backtestBaselineSchema = z.object({
  // Core parameters
  duckdb: z.string().default('data/alerts.duckdb'),
  chain: z.string().default('solana'),
  from: z.string().optional(), // YYYY-MM-DD, defaults to 30 days ago
  to: z.string().optional(), // YYYY-MM-DD, defaults to today
  intervalSeconds: z.coerce
    .number()
    .int()
    .refine((v) => v === 60 || v === 300)
    .default(60),
  horizonHours: z.coerce.number().int().positive().default(48),
  threads: z.coerce.number().int().positive().default(16),

  // Slice management (offline backtest)
  sliceDir: z.string().default('slices'),
  reuseSlice: z.boolean().default(false),
  minCoveragePct: z.coerce.number().min(0).max(1).default(0.8),

  // Output
  outDir: z.string().default('results'),
  outCsv: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).optional().default('table'),

  // ClickHouse (native protocol)
  chHost: z.string().optional(),
  chPort: z.coerce.number().int().positive().optional(),
  chDb: z.string().optional(),
  chTable: z.string().optional(),
  chUser: z.string().optional(),
  chPass: z.string().optional(),
  chConnectTimeout: z.coerce.number().int().positive().optional(),
  chTimeoutS: z.coerce.number().int().positive().optional(),

  // (TP/SL policy removed - pure path metrics only)

  // TUI mode
  tui: z.boolean().optional().default(false),
});

export type BacktestBaselineArgs = z.infer<typeof backtestBaselineSchema>;
