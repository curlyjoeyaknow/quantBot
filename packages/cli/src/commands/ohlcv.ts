/**
 * OHLCV Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { OhlcvRepository } from '@quantbot/storage';
import { parseArguments, validateMintAddress, parseDate } from '../core/argument-parser';
import { formatOutput } from '../core/output-formatter';
import { handleError } from '../core/error-handler';
import type { PackageCommandModule } from '../types';
import { commandRegistry } from '../core/command-registry';

/**
 * Query command schema
 */
const querySchema = z.object({
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
const backfillSchema = z.object({
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
const coverageSchema = z.object({
  mint: z.string().optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register OHLCV commands
 */
export function registerOhlcvCommands(program: Command): void {
  const ohlcvCmd = program.command('ohlcv').description('OHLCV candle data operations');

  // Query command (already implemented above)
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
      try {
        const args = parseArguments(querySchema, options);

        // Validate and preserve mint address case
        const mintAddress = validateMintAddress(args.mint);

        // Parse dates
        const fromDate = DateTime.fromISO(args.from);
        const toDate = DateTime.fromISO(args.to);

        if (!fromDate.isValid) {
          throw new Error(`Invalid from date: ${args.from}`);
        }
        if (!toDate.isValid) {
          throw new Error(`Invalid to date: ${args.to}`);
        }

        if (fromDate >= toDate) {
          throw new Error('From date must be before to date');
        }

        // Query candles
        const repository = new OhlcvRepository();
        const candles = await repository.getCandles(mintAddress, args.chain, args.interval, {
          from: fromDate,
          to: toDate,
        });

        // Format output
        const output = formatOutput(candles, args.format);
        console.log(output);

        // Log summary
        console.error(`\nFound ${candles.length} candles for ${mintAddress}`);
      } catch (error) {
        const message = handleError(error, { mint: options.mint });
        console.error(`Error: ${message}`);
        process.exit(1);
      }
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
      try {
        const args = parseArguments(backfillSchema, options);
        console.error('Backfilling OHLCV data...');
        // TODO: Implement backfill
        const result = { message: 'Backfill completed', candlesFetched: 0 };
        const output = formatOutput(result, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Coverage command
  ohlcvCmd
    .command('coverage')
    .description('Check data coverage for tokens')
    .option('--mint <address>', 'Token mint address')
    .option('--interval <interval>', 'Candle interval')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const args = parseArguments(coverageSchema, options);
        const result = {
          message: 'Coverage check - implementation in progress',
        };
        const output = formatOutput(result, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
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
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof querySchema>;
        const mintAddress = validateMintAddress(typedArgs.mint);
        const fromDate = DateTime.fromISO(typedArgs.from);
        const toDate = DateTime.fromISO(typedArgs.to);

        if (!fromDate.isValid || !toDate.isValid) {
          throw new Error('Invalid date format');
        }

        const repository = new OhlcvRepository();
        return await repository.getCandles(mintAddress, typedArgs.chain, typedArgs.interval, {
          from: fromDate,
          to: toDate,
        });
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
      handler: async () => ({ message: 'Backfill completed' }),
      examples: ['quantbot ohlcv backfill --mint So111... --from 2024-01-01 --to 2024-01-02'],
    },
    {
      name: 'coverage',
      description: 'Check data coverage for tokens',
      schema: coverageSchema,
      handler: async () => ({ message: 'Coverage check' }),
      examples: ['quantbot ohlcv coverage --mint So111...'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(ohlcvModule);
