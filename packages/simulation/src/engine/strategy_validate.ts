/**
 * Strategy Validation
 *
 * Zod schemas for strategy JSON validation.
 * Matches Python strategy_validate.py logic.
 */

import { z } from 'zod';

const TargetSchema = z.object({
  size_pct: z.number().positive().max(100),
  profit_pct: z.number().positive(),
});

const TrailingConfigSchema = z.object({
  enabled: z.boolean().optional(),
  trail_pct: z.number().nonnegative().optional(),
  activate_profit_pct: z.number().nonnegative().optional(),
});

const TimeExitConfigSchema = z.object({
  enabled: z.boolean().optional(),
  max_candles_in_trade: z.number().int().positive().optional(),
});

const ExitsConfigSchema = z.object({
  targets: z.array(TargetSchema).optional(),
  trailing: TrailingConfigSchema.optional(),
  time_exit: TimeExitConfigSchema.optional(),
});

const StopsConfigSchema = z.object({
  stop_loss_pct: z.number().nonnegative(),
  break_even_after_first_target: z.boolean().optional(),
});

const EntrySignalSchema = z.object({
  type: z.enum(['rsi_below', 'ema_cross']),
  period: z.number().int().positive().optional(), // For RSI
  value: z.number().optional(), // For RSI threshold
  fast: z.number().int().positive().optional(), // For EMA cross
  slow: z.number().int().positive().optional(), // For EMA cross
  direction: z.enum(['bull', 'bear']).optional(), // For EMA cross
});

const EntryDelaySchema = z.object({
  mode: z.enum(['none', 'candles']),
  n: z.number().int().nonnegative().optional(),
});

const EntryConfigSchema = z.object({
  mode: z.enum(['immediate', 'signal']),
  signal: EntrySignalSchema.optional(),
  delay: EntryDelaySchema.optional(),
});

const ExecutionConfigSchema = z.object({
  fill_model: z.enum(['open', 'close']),
  fee_bps: z.number().nonnegative(),
  slippage_bps: z.number().nonnegative(),
});

export const StrategyConfigSchema = z.object({
  entry: EntryConfigSchema,
  exits: ExitsConfigSchema,
  stops: StopsConfigSchema,
  execution: ExecutionConfigSchema,
});

export type StrategyConfig = z.infer<typeof StrategyConfigSchema>;

/**
 * Validate strategy configuration
 *
 * @param strategy - Strategy configuration object
 * @throws Error if validation fails
 */
export function validateStrategy(strategy: unknown): asserts strategy is StrategyConfig {
  // Parse with Zod
  const result = StrategyConfigSchema.safeParse(strategy);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Strategy validation failed: ${issues}`);
  }

  const config = result.data;

  // Check targets size sum <= 100
  const targets = config.exits?.targets || [];
  const sizeSum = targets.reduce((sum, t) => sum + t.size_pct, 0);
  if (sizeSum > 100.0 + 1e-9) {
    throw new Error('targets size_pct sum must be <= 100');
  }

  // Check trailing config if enabled
  const trailing = config.exits?.trailing;
  if (trailing?.enabled) {
    if (!trailing.trail_pct || trailing.trail_pct <= 0) {
      throw new Error('trailing.trail_pct must be > 0 when enabled');
    }
    if (trailing.activate_profit_pct !== undefined && trailing.activate_profit_pct < 0) {
      throw new Error('trailing.activate_profit_pct must be >= 0');
    }
  }

  // Check time exit config if enabled
  const timeExit = config.exits?.time_exit;
  if (timeExit?.enabled) {
    if (!timeExit.max_candles_in_trade || timeExit.max_candles_in_trade <= 0) {
      throw new Error('time_exit.max_candles_in_trade must be > 0 when enabled');
    }
  }

  // Require at least one exit path
  const hasExit =
    targets.length > 0 || trailing?.enabled || timeExit?.enabled || config.stops.stop_loss_pct > 0;

  if (!hasExit) {
    throw new Error('strategy must define at least one exit path (targets/trailing/time/stop)');
  }
}
