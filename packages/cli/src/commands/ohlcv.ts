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
import { coverageOhlcvHandler } from './ohlcv/coverage-ohlcv.js';
import { analyzeCoverageHandler } from './ohlcv/analyze-coverage.js';
import { analyzeDetailedCoverageHandler } from '../handlers/ohlcv/analyze-detailed-coverage.js';

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
  timeout: z.number().int().positive().optional(), // Timeout in milliseconds
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
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 1800000 = 30 minutes)');

  defineCommand(analyzeDetailedCoverageCmd, {
    name: 'analyze-detailed-coverage',
    packageName: 'ohlcv',
    coerce: (raw) => ({
      ...raw,
      timeout: raw.timeout ? coerceNumber(raw.timeout, 'timeout') : undefined,
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
  ],
};

// Register the module
commandRegistry.registerPackage(ohlcvModule);
