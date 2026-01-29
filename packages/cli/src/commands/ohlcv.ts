/**
 * OHLCV Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { parseDate, validateMintAddress } from '../core/argument-parser.js';
import type { PackageCommandModule } from '../types/index.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceBoolean, coerceNumber } from '../core/coerce.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { queryOhlcvHandler } from './ohlcv/query-ohlcv.js';
import { backfillOhlcvHandler } from './ohlcv/backfill-ohlcv.js';
import { fetchOhlcvHandler, fetchOhlcvSchema } from '../handlers/ohlcv/fetch-ohlcv.js';
import {
  fetchFromDuckdbHandler,
  fetchFromDuckdbSchema,
} from '../handlers/ohlcv/fetch-from-duckdb.js';
import { coverageOhlcvHandler } from './ohlcv/coverage-ohlcv.js';
import { analyzeCoverageHandler } from './ohlcv/analyze-coverage.js';
import { analyzeDetailedCoverageHandler } from '../handlers/ohlcv/analyze-detailed-coverage.js';
import { coverageMapHandler, coverageMapSchema } from '../handlers/ohlcv/coverage-map.js';
import {
  alertCoverageMapHandler,
  alertCoverageMapSchema,
} from '../handlers/ohlcv/alert-coverage-map.js';
import {
  coverageDashboardHandler,
  coverageDashboardSchema,
} from '../handlers/ohlcv/coverage-dashboard.js';
import { tokenLifespanHandler, tokenLifespanSchema } from '../handlers/ohlcv/token-lifespan.js';
import { dedupSweepHandler } from '../handlers/ohlcv/dedup-sweep.js';
import { runsListHandler } from '../handlers/ohlcv/runs-list.js';
import { runsRollbackHandler } from '../handlers/ohlcv/runs-rollback.js';
import { runsDetailsHandler } from '../handlers/ohlcv/runs-details.js';
import { validateDuplicatesHandler } from '../handlers/ohlcv/validate-duplicates.js';
import { exportOhlcvSliceCLIHandler } from '../handlers/ohlcv/export-slice.js';

/**
 * Fetch command schema (re-exported from handler)
 */
export { fetchOhlcvSchema };

/**
 * Query command schema
 */
export const querySchema = z.object({
  mint: z.string().refine(
    (val) => {
      try {
        validateMintAddress(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid mint address (must be 32-44 characters)' }
  ),
  from: z.string().refine(
    (val) => {
      try {
        parseDate(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid date format (expected ISO 8601)' }
  ),
  to: z.string().refine(
    (val) => {
      try {
        parseDate(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid date format (expected ISO 8601)' }
  ),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('5m'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).default('solana'),
});

/**
 * Backfill command schema
 */
export const backfillSchema = z.object({
  mint: z.string().refine(
    (val) => {
      try {
        validateMintAddress(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid mint address (must be 32-44 characters)' }
  ),
  from: z.string(),
  to: z.string(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('5m'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).default('solana'),
});

/**
 * Coverage command schema
 */
export const coverageSchema = z.object({
  mint: z.string().optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Analyze coverage command schema
 */
export const analyzeCoverageSchema = z.object({
  analysisType: z.enum(['overall', 'caller']).default('overall'),
  duckdb: z.string().optional(), // For caller analysis
  chain: z.string().optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '1s', '15s']).optional(),
  startDate: z.string().optional(), // YYYY-MM-DD
  endDate: z.string().optional(),
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  caller: z.string().optional(),
  minCoverage: z.number().min(0).max(1).default(0.8),
  generateFetchPlan: z.boolean().default(false),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  timeout: z.number().int().positive().optional(), // Timeout in milliseconds
});

/**
 * Analyze detailed coverage command schema
 */
export const analyzeDetailedCoverageSchema = z.object({
  duckdb: z.string(),
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM
  caller: z.string().optional(),
  format: z.enum(['json', 'csv']).default('json'),
  limit: z.number().int().positive().optional(),
  summaryOnly: z.boolean().default(false),
  timeout: z.number().int().positive().optional(), // Timeout in milliseconds
});

/**
 * Dedup sweep command schema
 */
export const dedupSweepSchema = z.object({
  intervals: z.array(z.enum(['1m', '5m'])).optional(),
  olderThan: z.string().optional(),
  dryRun: z.boolean().default(false),
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Runs list command schema
 */
export const runsListSchema = z.object({
  status: z.enum(['running', 'completed', 'failed', 'rolled_back']).optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().default(100),
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Runs rollback command schema
 */
export const runsRollbackSchema = z.object({
  runId: z.string(),
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Runs details command schema
 */
export const runsDetailsSchema = z.object({
  runId: z.string(),
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Validate duplicates command schema
 */
export const validateDuplicatesSchema = z.object({
  minErrorRate: z.number().min(0).max(1).default(0.1),
  minZeroVolumeRate: z.number().min(0).max(1).default(0.5),
  checkConsistency: z.boolean().default(true),
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Export OHLCV slice command schema
 */
export const exportSliceSchema = z.object({
  token: z.string().refine(
    (val) => {
      try {
        validateMintAddress(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid mint address (must be 32-44 characters)' }
  ),
  resolution: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
  from: z.string().refine(
    (val) => {
      try {
        parseDate(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid date format (expected ISO 8601)' }
  ),
  to: z.string().refine(
    (val) => {
      try {
        parseDate(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid date format (expected ISO 8601)' }
  ),
  chain: z.enum(['solana', 'evm']).default('solana'),
  format: z.enum(['json', 'table']).default('table'),
});

/**
 * Register OHLCV commands
 */
export function registerOhlcvCommands(program: Command): void {
  const ohlcvCmd = program.command('ohlcv').description('OHLCV candle data operations');

  // Query command
  const queryCmd = ohlcvCmd
    .command('query')
    .description('Query OHLCV candles for a token')
    .requiredOption('--mint <address>', 'Token mint address (32-44 chars, case-preserved)')
    .requiredOption('--from <date>', 'Start date (ISO 8601: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)')
    .requiredOption('--to <date>', 'End date (ISO 8601: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)')
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--format <format>', 'Output format', 'table')
    .option('--chain <chain>', 'Blockchain', 'solana');

  defineCommand(queryCmd, {
    name: 'query',
    packageName: 'ohlcv',
    onError: die,
  });

  // Direct fetch command (bypasses worklist - fast single-mint fetch)
  const fetchCmd = ohlcvCmd
    .command('fetch')
    .description('Directly fetch OHLCV candles for a single mint (fast, bypasses worklist)')
    .requiredOption('--mint <address>', 'Token mint address')
    .option('--chain <chain>', 'Blockchain', 'solana')
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--from <date>', 'Start date (ISO 8601), defaults to start of today')
    .option('--to <date>', 'End date (ISO 8601), defaults to now')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(fetchCmd, {
    name: 'fetch',
    packageName: 'ohlcv',
    validate: (opts) => fetchOhlcvSchema.parse(opts),
    onError: die,
  });

  // Fetch from DuckDB alerts command
  const fetchFromDuckdbCmd = ohlcvCmd
    .command('fetch-from-duckdb')
    .description('Fetch OHLCV candles for all alerts/calls in DuckDB (groups by mint)')
    .requiredOption('--duckdb <path>', 'Path to DuckDB database file')
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--from <date>', 'Filter alerts from this date (ISO 8601)')
    .option('--to <date>', 'Filter alerts to this date, and fetch until this date (ISO 8601)')
    .option('--side <side>', 'Filter by side (buy/sell)', 'buy')
    .option('--chain <chain>', 'Filter by chain (solana, ethereum, bsc, base)')
    .option('--concurrency <n>', 'Number of parallel fetches (1-50)', '2')
    .option('--delay-ms <ms>', 'Delay between batch requests in milliseconds', '200')
    .option(
      '--horizon-seconds <seconds>',
      'Minimum forward time window in seconds (default: 7200 = 2 hours)',
      '7200'
    )
    .option('--format <format>', 'Output format', 'table');

  defineCommand(fetchFromDuckdbCmd, {
    name: 'fetch-from-duckdb',
    packageName: 'ohlcv',
    validate: (opts) => fetchFromDuckdbSchema.parse(opts),
    onError: die,
  });

  // Backfill command
  const backfillCmd = ohlcvCmd
    .command('backfill')
    .description('Backfill OHLCV data for a token')
    .requiredOption('--mint <address>', 'Token mint address')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--format <format>', 'Output format', 'table')
    .option('--chain <chain>', 'Blockchain', 'solana');

  defineCommand(backfillCmd, {
    name: 'backfill',
    packageName: 'ohlcv',
    onError: die,
  });

  // Coverage command
  const coverageCmd = ohlcvCmd
    .command('coverage')
    .description('Check data coverage for tokens')
    .option('--mint <address>', 'Token mint address')
    .option('--interval <interval>', 'Candle interval')
    .option('--format <format>', 'Output format', 'table')
    .option('--output-file <path>', 'Write output to file (JSON/CSV/table format)');

  defineCommand(coverageCmd, {
    name: 'coverage',
    packageName: 'ohlcv',
    onError: die,
  });

  // Analyze coverage command
  const analyzeCoverageCmd = ohlcvCmd
    .command('analyze-coverage')
    .description('Analyze OHLCV coverage (overall or caller-based)')
    .option('--type <type>', 'Analysis type: overall or caller', 'overall')
    .option('--duckdb <path>', 'Path to DuckDB database (for caller analysis)')
    .option('--chain <chain>', 'Filter by chain')
    .option('--interval <interval>', 'Filter by interval')
    .option('--start-date <date>', 'Start date (YYYY-MM-DD, for overall)')
    .option('--end-date <date>', 'End date (YYYY-MM-DD, for overall)')
    .option('--start-month <month>', 'Start month (YYYY-MM, for caller)')
    .option('--end-month <month>', 'End month (YYYY-MM, for caller)')
    .option('--caller <name>', 'Filter by caller (for caller analysis)')
    .option('--min-coverage <ratio>', 'Minimum coverage threshold (0-1)')
    .option('--generate-fetch-plan', 'Generate fetch plan (for caller analysis)')
    .option('--format <format>', 'Output format', 'table')
    .option('--output-file <path>', 'Write output to file (JSON/CSV/table format)')
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 900000 = 15 minutes)');

  defineCommand(analyzeCoverageCmd, {
    name: 'analyze-coverage',
    packageName: 'ohlcv',
    coerce: (raw) => ({
      ...raw,
      analysisType: raw.type || 'overall',
      generateFetchPlan:
        raw.generateFetchPlan !== undefined
          ? coerceBoolean(raw.generateFetchPlan, 'generate-fetch-plan')
          : false,
      minCoverage: raw.minCoverage ? coerceNumber(raw.minCoverage, 'min-coverage') : 0.8,
      timeout: raw.timeout ? coerceNumber(raw.timeout, 'timeout') : undefined,
    }),
    onError: die,
  });

  // Analyze detailed coverage command
  const analyzeDetailedCoverageCmd = ohlcvCmd
    .command('analyze-detailed-coverage')
    .description('Generate detailed OHLCV coverage report (by mint, caller, day, month)')
    .requiredOption('--duckdb <path>', 'Path to DuckDB database')
    .option('--start-month <month>', 'Start month (YYYY-MM format)')
    .option('--end-month <month>', 'End month (YYYY-MM format)')
    .option('--caller <name>', 'Filter by specific caller')
    .option('--format <format>', 'Output format (json or csv)', 'json')
    .option('--limit <count>', 'Limit number of calls to process (for debugging)')
    .option('--summary-only', 'Return summary and metadata only (omit per-call details)')
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 1800000 = 30 minutes)');

  defineCommand(analyzeDetailedCoverageCmd, {
    name: 'analyze-detailed-coverage',
    packageName: 'ohlcv',
    coerce: (raw) => ({
      ...raw,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : undefined,
      summaryOnly:
        raw.summaryOnly !== undefined ? coerceBoolean(raw.summaryOnly, 'summary-only') : false,
      timeout: raw.timeout ? coerceNumber(raw.timeout, 'timeout') : undefined,
    }),
    onError: die,
  });

  // Coverage map command (precise coverage statistics with colored output)
  const coverageMapCmd = ohlcvCmd
    .command('coverage-map')
    .description('Show precise OHLCV coverage statistics by interval with colored output')
    .option('--from <date>', 'Filter from date (ISO 8601: YYYY-MM-DD)')
    .option('--to <date>', 'Filter to date (ISO 8601: YYYY-MM-DD)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(coverageMapCmd, {
    name: 'coverage-map',
    packageName: 'ohlcv',
    onError: die,
  });

  // Alert coverage map command (per-alert coverage analysis)
  const alertCoverageMapCmd = ohlcvCmd
    .command('alert-coverage-map')
    .description('Check OHLCV coverage for each alert from DuckDB (per-alert, per-interval)')
    .requiredOption('--duckdb <path>', 'Path to DuckDB database file')
    .option('--from <date>', 'Filter alerts from date (ISO 8601: YYYY-MM-DD)')
    .option('--to <date>', 'Filter alerts to date (ISO 8601: YYYY-MM-DD)')
    .option(
      '--horizon-seconds <seconds>',
      'Required forward coverage in seconds (default: 7200 = 2 hours)',
      '7200'
    )
    .option('--interval <interval>', 'Check specific interval only (1s, 15s, 1m, 5m)')
    .option('--min-coverage <ratio>', 'Minimum coverage threshold 0-1 (default: 0.95)', '0.95')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(alertCoverageMapCmd, {
    name: 'alert-coverage-map',
    packageName: 'ohlcv',
    onError: die,
  });

  // Coverage dashboard command (real-time monitoring)
  const coverageDashboardCmd = ohlcvCmd
    .command('coverage-dashboard')
    .description('Real-time OHLCV coverage dashboard for alerts (refreshes every 5s)')
    .requiredOption('--duckdb <path>', 'Path to DuckDB database file')
    .option('--from <date>', 'Filter alerts from date (ISO 8601: YYYY-MM-DD)')
    .option('--to <date>', 'Filter alerts to date (ISO 8601: YYYY-MM-DD)')
    .option('--refresh-interval <seconds>', 'Refresh interval in seconds (default: 5)', '5')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(coverageDashboardCmd, {
    name: 'coverage-dashboard',
    packageName: 'ohlcv',
    onError: die,
  });

  // Token lifespan analysis command
  const tokenLifespanCmd = ohlcvCmd
    .command('token-lifespan')
    .description(
      'Analyze token lifespans to determine effective coverage (dead tokens with full lifespan = full coverage)'
    )
    .requiredOption('--duckdb <path>', 'Path to DuckDB database file')
    .option('--from <date>', 'Filter alerts from date (ISO 8601: YYYY-MM-DD)')
    .option('--to <date>', 'Filter alerts to date (ISO 8601: YYYY-MM-DD)')
    .option('--interval <interval>', 'Candle interval (1m or 5m)', '1m')
    .option(
      '--min-coverage-seconds <seconds>',
      'Minimum coverage threshold in seconds (default: 150000)',
      '150000'
    )
    .option('--concurrency <n>', 'Number of concurrent Birdeye API calls (default: 5)', '5')
    .option('--refresh-cache', 'Force re-fetch from Birdeye API (ignore cache)', false)
    .option('--format <format>', 'Output format', 'table');

  defineCommand(tokenLifespanCmd, {
    name: 'token-lifespan',
    packageName: 'ohlcv',
    onError: die,
  });

  // Dedup sweep command
  const dedupSweepCmd = ohlcvCmd
    .command('dedup-sweep')
    .description('Run deduplication sweep across all interval tables')
    .option('--intervals <intervals...>', 'Intervals to process (1m, 5m)', ['1m', '5m'])
    .option('--older-than <date>', 'Only process candles older than this date (ISO 8601)')
    .option('--dry-run', 'Show what would be deduplicated without making changes', false)
    .option('--format <format>', 'Output format', 'table');

  defineCommand(dedupSweepCmd, {
    name: 'dedup-sweep',
    packageName: 'ohlcv',
    coerce: (opts) => ({
      ...opts,
      intervals: Array.isArray(opts.intervals) ? opts.intervals : [opts.intervals].filter(Boolean),
      dryRun: coerceBoolean(opts.dryRun, 'dry-run') ?? false,
    }),
    onError: die,
  });

  // Runs list command
  const runsListCmd = ohlcvCmd
    .command('runs-list')
    .description('List ingestion runs with optional filtering')
    .option('--status <status>', 'Filter by status (running, completed, failed, rolled_back)')
    .option('--since <date>', 'Filter runs since this date (ISO 8601)')
    .option('--limit <n>', 'Maximum number of runs to return', '100')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runsListCmd, {
    name: 'runs-list',
    packageName: 'ohlcv',
    coerce: (opts) => ({
      ...opts,
      limit: coerceNumber(opts.limit, 'limit') ?? 100,
    }),
    onError: die,
  });

  // Runs rollback command
  const runsRollbackCmd = ohlcvCmd
    .command('runs-rollback')
    .description('Rollback (delete) all candles from a specific run')
    .requiredOption('--runId <id>', 'Run ID to rollback')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runsRollbackCmd, {
    name: 'runs-rollback',
    packageName: 'ohlcv',
    onError: die,
  });

  // Runs details command
  const runsDetailsCmd = ohlcvCmd
    .command('runs-details')
    .description('Get detailed information about a specific run')
    .requiredOption('--runId <id>', 'Run ID to get details for')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(runsDetailsCmd, {
    name: 'runs-details',
    packageName: 'ohlcv',
    onError: die,
  });

  // Validate duplicates command
  const validateDuplicatesCmd = ohlcvCmd
    .command('validate-duplicates')
    .description('Check for faulty runs with high error/corruption rates')
    .option('--min-error-rate <rate>', 'Minimum error rate threshold (0-1)', '0.1')
    .option('--min-zero-volume-rate <rate>', 'Minimum zero-volume rate threshold (0-1)', '0.5')
    .option('--check-consistency', 'Check data consistency', true)
    .option('--format <format>', 'Output format', 'table');

  defineCommand(validateDuplicatesCmd, {
    name: 'validate-duplicates',
    packageName: 'ohlcv',
    coerce: (opts) => ({
      ...opts,
      minErrorRate: coerceNumber(opts.minErrorRate, 'min-error-rate') ?? 0.1,
      minZeroVolumeRate: coerceNumber(opts.minZeroVolumeRate, 'min-zero-volume-rate') ?? 0.5,
      checkConsistency: coerceBoolean(opts.checkConsistency, 'check-consistency') ?? true,
    }),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const ohlcvModule: PackageCommandModule = {
  packageName: 'ohlcv',
  description: 'OHLCV candle data operations',
  commands: [
    {
      name: 'query',
      description: 'Query OHLCV candles for a token',
      schema: querySchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof querySchema>;
        return await queryOhlcvHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv query --mint So111... --from 2024-01-01 --to 2024-01-02',
        'quantbot ohlcv query --mint So111... --from 2024-01-01T00:00:00Z --to 2024-01-02T00:00:00Z --interval 1m --format json',
      ],
    },
    {
      name: 'fetch',
      description: 'Directly fetch OHLCV candles for a single mint (fast, bypasses worklist)',
      schema: fetchOhlcvSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof fetchOhlcvSchema>;
        return await fetchOhlcvHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv fetch --mint AbeDBXvqGnmcvX8NtQg5qgREFTw7HynkCc4u97xcpump --interval 15s',
        'quantbot ohlcv fetch --mint AbeDBXvqGnmcvX8NtQg5qgREFTw7HynkCc4u97xcpump --interval 15s --chain solana --from 2024-12-27T00:00:00Z',
      ],
    },
    {
      name: 'fetch-from-duckdb',
      description: 'Fetch OHLCV candles for all alerts/calls in DuckDB (groups by mint)',
      schema: fetchFromDuckdbSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof fetchFromDuckdbSchema>;
        return await fetchFromDuckdbHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv fetch-from-duckdb --duckdb data/tele.duckdb --interval 5m',
        'quantbot ohlcv fetch-from-duckdb --duckdb data/tele.duckdb --interval 1m --from 2024-12-01 --to 2024-12-31',
        'quantbot ohlcv fetch-from-duckdb --duckdb data/tele.duckdb --interval 5m --concurrency 4',
      ],
    },
    {
      name: 'backfill',
      description: 'Backfill OHLCV data for a token',
      schema: backfillSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof backfillSchema>;
        return await backfillOhlcvHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot ohlcv backfill --mint So111... --from 2024-01-01 --to 2024-01-02'],
    },
    {
      name: 'coverage',
      description: 'Check data coverage for tokens',
      schema: coverageSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof coverageSchema>;
        return await coverageOhlcvHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot ohlcv coverage --mint So111...'],
    },
    {
      name: 'analyze-coverage',
      description: 'Analyze OHLCV coverage (overall or caller-based)',
      schema: analyzeCoverageSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof analyzeCoverageSchema>;
        return await analyzeCoverageHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv analyze-coverage --type overall',
        'quantbot ohlcv analyze-coverage --type caller --duckdb data/tele.duckdb',
        'quantbot ohlcv analyze-coverage --type caller --caller Brook --generate-fetch-plan',
      ],
    },
    {
      name: 'analyze-detailed-coverage',
      description: 'Generate detailed OHLCV coverage report (by mint, caller, day, month)',
      schema: analyzeDetailedCoverageSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof analyzeDetailedCoverageSchema>;
        return await analyzeDetailedCoverageHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv analyze-detailed-coverage --duckdb data/tele.duckdb',
        'quantbot ohlcv analyze-detailed-coverage --duckdb data/tele.duckdb --start-month 2025-12',
        'quantbot ohlcv analyze-detailed-coverage --duckdb data/tele.duckdb --caller Brook --format csv',
      ],
    },
    {
      name: 'coverage-map',
      description: 'Show precise OHLCV coverage statistics by interval with colored output',
      schema: coverageMapSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof coverageMapSchema>;
        return await coverageMapHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv coverage-map',
        'quantbot ohlcv coverage-map --from 2025-05-01 --to 2025-06-01',
        'quantbot ohlcv coverage-map --format json',
      ],
    },
    {
      name: 'alert-coverage-map',
      description: 'Check OHLCV coverage for each alert from DuckDB (per-alert, per-interval)',
      schema: alertCoverageMapSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof alertCoverageMapSchema>;
        return await alertCoverageMapHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv alert-coverage-map --duckdb ~/tele.duckdb',
        'quantbot ohlcv alert-coverage-map --duckdb ~/tele.duckdb --from 2025-05-01 --to 2025-06-01',
        'quantbot ohlcv alert-coverage-map --duckdb ~/tele.duckdb --horizon-seconds 3600 --interval 1m',
      ],
    },
    {
      name: 'coverage-dashboard',
      description: 'Real-time OHLCV coverage dashboard for alerts (refreshes every 5s)',
      schema: coverageDashboardSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof coverageDashboardSchema>;
        return await coverageDashboardHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv coverage-dashboard --duckdb ~/alerts.duckdb --from 2025-05-01',
        'quantbot ohlcv coverage-dashboard --duckdb ~/alerts.duckdb --from 2025-05-01 --to 2025-06-01',
        'quantbot ohlcv coverage-dashboard --duckdb ~/alerts.duckdb --refresh-interval 10',
      ],
    },
    {
      name: 'token-lifespan',
      description:
        'Analyze token lifespans to determine effective coverage (dead tokens with full lifespan = full coverage)',
      schema: tokenLifespanSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof tokenLifespanSchema>;
        return await tokenLifespanHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv token-lifespan --duckdb ~/alerts.duckdb --interval 1m',
        'quantbot ohlcv token-lifespan --duckdb ~/alerts.duckdb --from 2025-05-01 --interval 1m',
        'quantbot ohlcv token-lifespan --duckdb ~/alerts.duckdb --min-coverage-seconds 150000',
      ],
    },
    {
      name: 'dedup-sweep',
      description: 'Run deduplication sweep across all interval tables',
      schema: dedupSweepSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof dedupSweepSchema>;
        return await dedupSweepHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv dedup-sweep',
        'quantbot ohlcv dedup-sweep --intervals 1m 5m',
        'quantbot ohlcv dedup-sweep --dry-run',
      ],
    },
    {
      name: 'runs-list',
      description: 'List ingestion runs with optional filtering',
      schema: runsListSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof runsListSchema>;
        return await runsListHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv runs-list',
        'quantbot ohlcv runs-list --status failed',
        'quantbot ohlcv runs-list --since 2025-01-01 --limit 50',
      ],
    },
    {
      name: 'runs-rollback',
      description: 'Rollback (delete) all candles from a specific run',
      schema: runsRollbackSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof runsRollbackSchema>;
        return await runsRollbackHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot ohlcv runs-rollback --run-id abc123-def456-ghi789'],
    },
    {
      name: 'runs-details',
      description: 'Get detailed information about a specific run',
      schema: runsDetailsSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof runsDetailsSchema>;
        return await runsDetailsHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot ohlcv runs-details --run-id abc123-def456-ghi789'],
    },
    {
      name: 'validate-duplicates',
      description: 'Check for faulty runs with high error/corruption rates',
      schema: validateDuplicatesSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof validateDuplicatesSchema>;
        return await validateDuplicatesHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv validate-duplicates',
        'quantbot ohlcv validate-duplicates --min-error-rate 0.05',
        'quantbot ohlcv validate-duplicates --min-zero-volume-rate 0.3',
      ],
    },
    {
      name: 'export',
      description: 'Export OHLCV slice as artifact (Parquet + manifest)',
      schema: exportSliceSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof exportSliceSchema>;
        return await exportOhlcvSliceCLIHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ohlcv export --token ABC123... --resolution 1m --from 2025-05-01T00:00:00Z --to 2025-05-01T01:00:00Z',
        'quantbot ohlcv export --token ABC123... --resolution 5m --from 2025-05-01 --to 2025-05-02 --chain solana',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(ohlcvModule);
