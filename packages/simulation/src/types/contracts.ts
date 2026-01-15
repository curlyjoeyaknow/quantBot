/**
 * Canonical Simulation Contracts
 *
 * These contracts define the standard input/output format for simulations.
 * Both TypeScript and Python simulators must produce/consume data in this format.
 * This ensures parity and interoperability between implementations.
 */

import { z } from 'zod';
import type { ExecutionModel } from './execution-model.js';
import type { RiskModel } from './risk-model.js';

/**
 * Candle schema (canonical format)
 */
export const CandleSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export type Candle = z.infer<typeof CandleSchema>;

/**
 * Entry configuration schema
 */
export const EntryConfigSchema = z.object({
  initialEntry: z.union([z.number(), z.literal('none')]),
  trailingEntry: z.union([z.number(), z.literal('none')]),
  maxWaitTime: z.number(),
});

export type EntryConfig = z.infer<typeof EntryConfigSchema>;

/**
 * Exit configuration schema (profit targets + stop loss)
 */
export const ExitConfigSchema = z.object({
  profit_targets: z.array(
    z.object({
      target: z.number(),
      percent: z.number(),
    })
  ),
  stop_loss: z
    .object({
      initial: z.number(),
      trailing: z.union([z.number(), z.literal('none')]).optional(),
      trailingPercent: z.number().optional(),
      trailingWindowSize: z.number().optional(),
    })
    .optional(),
});

export type ExitConfig = z.infer<typeof ExitConfigSchema>;

/**
 * Re-entry configuration schema
 */
export const ReEntryConfigSchema = z
  .object({
    trailingReEntry: z.union([z.number(), z.literal('none')]),
    maxReEntries: z.number(),
    sizePercent: z.number(),
  })
  .optional();

export type ReEntryConfig = z.infer<typeof ReEntryConfigSchema>;

/**
 * Cost configuration schema
 */
export const CostConfigSchema = z
  .object({
    entrySlippageBps: z.number().optional(),
    exitSlippageBps: z.number().optional(),
    takerFeeBps: z.number().optional(),
    makerFeeBps: z.number().optional(),
    borrowAprBps: z.number().optional(),
  })
  .optional();

export type CostConfig = z.infer<typeof CostConfigSchema>;

/**
 * Current contract version
 */
export const CURRENT_CONTRACT_VERSION = '1.0.0';

/**
 * Supported contract versions (for backward compatibility)
 */
export const SUPPORTED_CONTRACT_VERSIONS = ['1.0.0'];

/**
 * Simulation input contract (canonical)
 *
 * Includes determinism contract fields for replayability:
 * - contractVersion: Version of simulation engine/contract
 * - seed: Random seed for deterministic execution
 * - dataVersion: Version of input data schema
 * - strategyVersion: Version of strategy definition
 */
export const SimInputSchema = z.object({
  run_id: z.string(),
  strategy_id: z.string(),
  mint: z.string(),
  alert_timestamp: z.string(), // ISO 8601
  candles: z.array(CandleSchema),
  entry_config: EntryConfigSchema,
  exit_config: ExitConfigSchema,
  reentry_config: ReEntryConfigSchema,
  cost_config: CostConfigSchema,

  // Determinism contract fields
  contractVersion: z.string().default('1.0.0'),
  seed: z.number().int().optional(),
  dataVersion: z.string().optional(),
  strategyVersion: z.string().optional(),

  // Execution model (no perfect fills)
  executionModel: z.record(z.string(), z.unknown()).optional(),

  // Risk model
  riskModel: z.record(z.string(), z.unknown()).optional(),

  // Data snapshot hash (for reproducibility)
  dataSnapshotHash: z.string().optional(),

  // Clock resolution (milliseconds, seconds, minutes, hours)
  clockResolution: z.enum(['ms', 's', 'm', 'h']).default('m'),
});

export type SimInput = z.infer<typeof SimInputSchema>;

/**
 * Simulation event schema
 */
export const SimEventSchema = z.object({
  event_type: z.string(),
  timestamp: z.number(),
  price: z.number(),
  quantity: z.number(),
  value_usd: z.number(),
  fee_usd: z.number(),
  pnl_usd: z.number().optional(),
  cumulative_pnl_usd: z.number().optional(),
  position_size: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SimEvent = z.infer<typeof SimEventSchema>;

/**
 * Simulation metrics schema
 */
export const SimMetricsSchema = z.object({
  max_drawdown: z.number().optional(),
  sharpe_ratio: z.number().optional(),
  win_rate: z.number().optional(),
  total_trades: z.number().optional(),
  profit_factor: z.number().optional(),
  average_win: z.number().optional(),
  average_loss: z.number().optional(),
});

export type SimMetrics = z.infer<typeof SimMetricsSchema>;

/**
 * Simulation result contract (canonical)
 */
export const SimResultSchema = z.object({
  run_id: z.string(),
  final_pnl: z.number(), // Multiplier (1.0 = break even)
  events: z.array(SimEventSchema),
  entry_price: z.number(),
  final_price: z.number(),
  total_candles: z.number(),
  metrics: SimMetricsSchema,
});

export type SimResult = z.infer<typeof SimResultSchema>;
