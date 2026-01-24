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
  entryRule: z
    .enum(['next_candle_open', 'next_candle_close', 'call_time_close'])
    .optional()
    .default('next_candle_open'),
  timeframeMs: z
    .number()
    .int()
    .positive()
    .optional()
    .default(24 * 60 * 60 * 1000), // Timeframe in milliseconds (default 24h)
  interval: z.enum(['1m', '5m', '15m', '1h']).optional().default('5m'), // Candle interval

  // Fees and position
  takerFeeBps: z.number().int().min(0).optional().default(30), // Taker fee in basis points
  slippageBps: z.number().int().min(0).optional().default(10), // Slippage in basis points
  notionalUsd: z.number().positive().optional().default(1000), // Position size in USD

  // Options
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type LabRunArgs = z.infer<typeof labRunSchema>;

/**
 * Lab sweep schema - Parameter sweeps for overlay backtesting
 *
 * Sweeps overlays (and optionally intervals/lags) to find optimal exit strategies.
 * Queries calls directly from DuckDB (unlike calls sweep which requires a calls file).
 */
export const labSweepSchema = z
  .object({
    // Data selection (same as lab run)
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    caller: z.string().optional(),
    mint: z.string().optional(),
    limit: z.number().int().min(1).max(10000).optional().default(1000),

    // Sweep parameters
    config: z.string().optional(), // Config file path (YAML/JSON)
    overlaysFile: z.string().optional(), // Path to JSON file with overlay sets
    overlaySetsFile: z.string().optional(), // Alias for overlaysFile
    intervals: z
      .array(z.enum(['1m', '5m', '15m', '1h']))
      .min(1, 'At least one interval is required')
      .optional(),
    lagsMs: z
      .array(z.coerce.number().int().min(0))
      .min(1, 'At least one lag is required')
      .optional(),

    // Output
    out: z.string().min(1, 'Output directory is required').optional(),
    parquetDir: z.string().optional(), // Parquet directory (alternative to DuckDB query)

    // Parallel processing
    workers: z.number().int().min(1).max(32).optional(), // Number of parallel workers

    // Entry alignment (same as lab run)
    entryRule: z
      .enum(['next_candle_open', 'next_candle_close', 'call_time_close'])
      .optional()
      .default('next_candle_open'),
    timeframeMs: z
      .number()
      .int()
      .positive()
      .optional()
      .default(24 * 60 * 60 * 1000),

    // Fees and position (same as lab run)
    takerFeeBps: z.number().int().min(0).optional().default(30),
    slippageBps: z.number().int().min(0).optional().default(10),
    notionalUsd: z.number().positive().optional().default(1000),

    // Options
    format: z.enum(['json', 'table', 'csv']).default('table'),
    resume: z.boolean().default(false), // Resume from previous run
  })
  .refine(
    (data) => {
      // If config is provided, these fields will be loaded from config
      if (data.config) return true;
      // If no config, require overlays file and output
      return data.overlaysFile || data.overlaySetsFile;
    },
    {
      message: 'Either provide --config, or one of: --overlays-file, --overlay-sets-file',
      path: ['overlaysFile'],
    }
  )
  .refine(
    (data) => {
      // If config is provided, output will be loaded from config
      if (data.config) return true;
      // If no config, require output directory
      return !!data.out;
    },
    {
      message: 'Either provide --config, or --out',
      path: ['out'],
    }
  );

export type LabSweepArgs = z.infer<typeof labSweepSchema>;

/**
 * Lab export-parquet schema - Export calls to Parquet format for parallel processing
 */
export const labExportParquetSchema = z.object({
  // Data selection
  duckdb: z.string().optional(), // DuckDB path (defaults to DUCKDB_PATH env var)
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  caller: z.string().optional(),
  mint: z.string().optional(),
  limit: z.number().int().min(1).max(100000).optional(), // Higher limit for export

  // Output
  out: z.string().min(1, 'Output directory is required'),
});

export type LabExportParquetArgs = z.infer<typeof labExportParquetSchema>;
