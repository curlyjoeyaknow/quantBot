import { z } from 'zod';

/**
 * Lab command schema - Overlay backtesting for quick experimentation
 * 
 * Lab is designed for quick exit strategy evaluation using overlay backtesting.
 * It assumes immediate entry at call time and tests different exit strategies.
 */
export const labRunSchema = z.object({
  // Data selection
  from: z.string().datetime().optional(), // Start date (ISO 8601)
  to: z.string().datetime().optional(), // End date (ISO 8601)
  caller: z.string().optional(), // Filter by caller
  mint: z.string().optional(), // Single mint address
  limit: z.number().int().min(1).max(10000).optional().default(100), // Max calls to simulate

  // Overlay backtesting (exit strategies)
  overlays: z.array(z.any()).min(1, 'At least one overlay is required'), // Exit overlays (take_profit, stop_loss, etc.)
  
  // Entry alignment
  lagMs: z.number().int().min(0).optional().default(10000), // Entry lag in milliseconds
  entryRule: z.enum(['next_candle_open', 'next_candle_close', 'call_time_close']).optional().default('next_candle_open'),
  timeframeMs: z.number().int().positive().optional().default(24 * 60 * 60 * 1000), // Timeframe in milliseconds (default 24h)
  interval: z.enum(['1m', '5m', '15m', '1h']).optional().default('5m'), // Candle interval

  // Fees and position
  takerFeeBps: z.number().int().min(0).optional().default(30), // Taker fee in basis points
  slippageBps: z.number().int().min(0).optional().default(10), // Slippage in basis points
  notionalUsd: z.number().positive().optional().default(1000), // Position size in USD

  // Options
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type LabRunArgs = z.infer<typeof labRunSchema>;
