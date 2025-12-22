/**
 * OHLCV Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { parseDate, validateMintAddress } from '../core/argument-parser.js';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { NotFoundError } from '@quantbot/utils';
import { queryOhlcvHandler } from './ohlcv/query-ohlcv.js';
import { backfillOhlcvHandler } from './ohlcv/backfill-ohlcv.js';
import { coverageOhlcvHandler } from './ohlcv/coverage-ohlcv.js';
import { analyzeCoverageHandler } from './ohlcv/analyze-coverage.js';

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
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
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
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
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
});

/**
 * Register OHLCV commands
 */
export function registerOhlcvCommands(program: Command): void {
  const ohlcvCmd = program.command('ohlcv').description('OHLCV candle data operations');

  // Query command
  ohlcvCmd
    .command('query')
    .description('Query OHLCV candles for a token')
    .requiredOption('--mint <address>', 'Token mint address (32-44 chars, case-preserved)')
    .requiredOption('--from <date>', 'Start date (ISO 8601: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)')
    .requiredOption('--to <date>', 'End date (ISO 8601: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)')
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--format <format>', 'Output format', 'table')
    .option('--chain <chain>', 'Blockchain', 'solana')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ohlcv', 'query');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ohlcv.query');
      }
      await execute(commandDef, options);
    });

  // Backfill command
  ohlcvCmd
    .command('backfill')
    .description('Backfill OHLCV data for a token')
    .requiredOption('--mint <address>', 'Token mint address')
    .requiredOption('--from <date>', 'Start date (ISO 8601)')
    .requiredOption('--to <date>', 'End date (ISO 8601)')
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--format <format>', 'Output format', 'table')
    .option('--chain <chain>', 'Blockchain', 'solana')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ohlcv', 'backfill');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ohlcv.backfill');
      }
      await execute(commandDef, options);
    });

  // Coverage command
  ohlcvCmd
    .command('coverage')
    .description('Check data coverage for tokens')
    .option('--mint <address>', 'Token mint address')
    .option('--interval <interval>', 'Candle interval')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ohlcv', 'coverage');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ohlcv.coverage');
      }
      await execute(commandDef, options);
    });

  // Analyze coverage command
  ohlcvCmd
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
    .option('--min-coverage <ratio>', 'Minimum coverage threshold (0-1)', '0.8')
    .option('--generate-fetch-plan', 'Generate fetch plan (for caller analysis)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ohlcv', 'analyze-coverage');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ohlcv.analyze-coverage');
      }
      await execute(commandDef, {
        ...options,
        analysisType: options.type,
        generateFetchPlan:
          options.generateFetchPlan === true || options.generateFetchPlan === 'true',
        minCoverage: options.minCoverage ? parseFloat(options.minCoverage) : 0.8,
      });
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
  ],
};

// Register the module
commandRegistry.registerPackage(ohlcvModule);
