/**
 * Ingestion Commands
 *
 * Command definitions: schema + description + examples + handler pointer.
 * No business logic, no service instantiation, no console.log, no process.exit.
 *
 * Note: Only ohlcv command is fully refactored. Telegram command still uses
 * the old pattern and will be migrated later.
 */

import type { Command } from 'commander';
import { z } from 'zod';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import { defineCommand } from '../core/defineCommand.js';
import { die } from '../core/cliErrors.js';
import { coerceNumber, coerceBoolean } from '../core/coerce.js';
import { ingestOhlcvHandler } from './ingestion/ingest-ohlcv.js';
import type { CommandContext } from '../core/command-context.js';
import { ingestTelegramHandler } from './ingestion/ingest-telegram.js';
import { processTelegramPythonHandler } from './ingestion/process-telegram-python.js';
import { validateAddressesHandler } from './ingestion/validate-addresses.js';
import { surgicalOhlcvFetchHandler } from './ingestion/surgical-ohlcv-fetch.js';
import { ensureOhlcvCoverageHandler } from '../handlers/ingestion/ensure-ohlcv-coverage.js';

/**
 * Telegram ingestion schema
 */
export const telegramSchema = z.object({
  file: z.string().min(1),
  callerName: z.string().optional(), // Optional - caller names are extracted from messages automatically
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).default('solana'),
  chatId: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * OHLCV ingestion schema
 */
export const ohlcvSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preWindow: z.number().int().positive().default(260),
  postWindow: z.number().int().positive().default(1440),
  interval: z.enum(['1m', '5m', '15m', '1h', '1s', '15s']).default('1m'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  duckdb: z.string().optional(), // Path to DuckDB database file
  candles: z.number().int().positive().default(5000), // Number of candles to fetch
  startOffsetMinutes: z.number().int().default(-52), // Minutes before alert to start fetching
});

/**
 * Surgical OHLCV fetch schema
 */
export const surgicalOhlcvFetchSchema = z.object({
  duckdb: z.string().optional(), // Path to DuckDB database file
  interval: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
  caller: z.string().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM format
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  auto: z.boolean().default(false),
  limit: z.number().int().positive().default(10),
  minCoverage: z.number().min(0).max(1).default(0.8),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Telegram Python pipeline schema
 */
export const telegramProcessSchema = z.object({
  file: z.string().min(1),
  outputDb: z.string().min(1),
  chatId: z.string().optional(), // Optional - will be extracted from file or default to "single_chat"
  rebuild: z.boolean().default(false),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Address validation schema
 */
export const validateAddressesSchema = z.object({
  addresses: z.array(z.string().min(1)).min(1),
  chainHint: z.enum(['solana', 'ethereum', 'bsc', 'base', 'evm']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Ensure OHLCV coverage schema
 */
export const ensureOhlcvCoverageSchema = z.object({
  duckdb: z.string().optional(), // Path to DuckDB database file
  maxAgeDays: z.number().int().positive().default(90), // Maximum age in days (default 3 months)
  limit: z.number().int().positive().optional(), // Limit number of tokens to process (default: 200)
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register ingestion commands
 */
export function registerIngestionCommands(program: Command): void {
  const ingestionCmd = program.command('ingestion').description('Data ingestion operations');

  // Telegram ingestion
  const telegramCmd = ingestionCmd
    .command('telegram')
    .description('Ingest Telegram export file (extracts all callers automatically)')
    .requiredOption('--file <path>', 'Path to Telegram HTML export file')
    .option(
      '--caller-name <name>',
      'Default caller name (optional - caller names are extracted from messages automatically)'
    )
    .option('--chain <chain>', 'Blockchain', 'solana')
    .option('--chat-id <id>', 'Chat ID (optional)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(telegramCmd, {
    name: 'telegram',
    packageName: 'ingestion',
    validate: (opts) => telegramSchema.parse(opts),
    onError: die,
  });

  // OHLCV ingestion
  const ohlcvCmd = ingestionCmd
    .command('ohlcv')
    .description('Fetch OHLCV data for calls')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--pre-window <minutes>', 'Pre-window minutes')
    .option('--post-window <minutes>', 'Post-window minutes')
    .option('--interval <interval>', 'Candle interval (1s, 15s, 1m, 5m, 15m, 1h)', '1m')
    .option('--candles <number>', 'Number of candles to fetch')
    .option('--start-offset-minutes <number>', 'Minutes before alert to start fetching')
    .option('--format <format>', 'Output format', 'table')
    .option('--duckdb <path>', 'Path to DuckDB database file (or set DUCKDB_PATH env var)');

  defineCommand(ohlcvCmd, {
    name: 'ohlcv',
    packageName: 'ingestion',
    coerce: (raw) => ({
      ...raw,
      preWindow: raw.preWindow ? coerceNumber(raw.preWindow, 'pre-window') : 260,
      postWindow: raw.postWindow ? coerceNumber(raw.postWindow, 'post-window') : 1440,
      candles: raw.candles ? coerceNumber(raw.candles, 'candles') : 5000,
      startOffsetMinutes: raw.startOffsetMinutes
        ? coerceNumber(raw.startOffsetMinutes, 'start-offset-minutes')
        : -52,
    }),
    validate: (opts) => ohlcvSchema.parse(opts),
    onError: die,
  });

  // Telegram Python pipeline
  const telegramPythonCmd = ingestionCmd
    .command('telegram-python')
    .description('Process Telegram export using Python DuckDB pipeline')
    .requiredOption('--file <path>', 'Path to Telegram JSON export file')
    .requiredOption('--output-db <path>', 'Output DuckDB file path')
    .option('--chat-id <id>', 'Chat ID (optional - will be extracted from file if single chat)')
    .option('--rebuild', 'Rebuild database')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(telegramPythonCmd, {
    name: 'telegram-python',
    packageName: 'ingestion',
    coerce: (raw) => ({
      ...raw,
      rebuild: raw.rebuild !== undefined ? coerceBoolean(raw.rebuild, 'rebuild') : false,
    }),
    validate: (opts) => telegramProcessSchema.parse(opts),
    onError: die,
  });

  // Address validation
  const validateAddressesCmd = ingestionCmd
    .command('validate-addresses')
    .description('Validate addresses and fetch metadata across chains')
    .argument('<addresses...>', 'Addresses to validate (space-separated)')
    .option('--chain-hint <chain>', 'Chain hint (solana, ethereum, base, bsc)')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(validateAddressesCmd, {
    name: 'validate-addresses',
    packageName: 'ingestion',
    argsToOpts: (args, rawOpts) => ({
      ...rawOpts,
      addresses: args[0] as string[],
    }),
    validate: (opts) => validateAddressesSchema.parse(opts),
    onError: die,
  });

  // Surgical OHLCV fetch
  const surgicalFetchCmd = ingestionCmd
    .command('surgical-fetch')
    .description('Surgical OHLCV fetching based on caller coverage analysis')
    .option('--duckdb <path>', 'Path to DuckDB database')
    .option('--interval <interval>', 'OHLCV interval', '5m')
    .option('--caller <name>', 'Specific caller to fetch for')
    .option('--month <YYYY-MM>', 'Specific month to fetch for')
    .option('--start-month <YYYY-MM>', 'Start month for analysis')
    .option('--end-month <YYYY-MM>', 'End month for analysis')
    .option('--auto', 'Automatically fetch for top priority gaps')
    .option('--limit <number>', 'Limit number of tasks in auto mode')
    .option('--min-coverage <ratio>', 'Minimum coverage threshold (0-1)')
    .option('--dry-run', 'Show what would be fetched without actually fetching')
    .option('--verbose', 'Show verbose progress output and progress bars')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(surgicalFetchCmd, {
    name: 'surgical-fetch',
    packageName: 'ingestion',
    coerce: (raw) => ({
      ...raw,
      auto: raw.auto !== undefined ? coerceBoolean(raw.auto, 'auto') : false,
      dryRun: raw.dryRun !== undefined ? coerceBoolean(raw.dryRun, 'dry-run') : false,
      verbose: raw.verbose !== undefined ? coerceBoolean(raw.verbose, 'verbose') : false,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 10,
      minCoverage: raw.minCoverage ? coerceNumber(raw.minCoverage, 'min-coverage') : 0.8,
    }),
    validate: (opts) => surgicalOhlcvFetchSchema.parse(opts),
    onError: die,
  });

  // Ensure OHLCV coverage
  const ensureCoverageCmd = ingestionCmd
    .command('ensure-coverage')
    .description(
      'Ensure OHLCV coverage for all tokens <3 months old (5000 15s, 10k 1m, 10k 5m candles)'
    )
    .option('--duckdb <path>', 'Path to DuckDB database file (or set DUCKDB_PATH env var)')
    .option('--max-age-days <days>', 'Maximum age in days (default: 90)', '90')
    .option('--limit <number>', 'Limit number of tokens to process (default: 200)', '200')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(ensureCoverageCmd, {
    name: 'ensure-coverage',
    packageName: 'ingestion',
    coerce: (raw) => ({
      ...raw,
      maxAgeDays: raw.maxAgeDays ? coerceNumber(raw.maxAgeDays, 'max-age-days') : 90,
      limit: raw.limit ? coerceNumber(raw.limit, 'limit') : 200,
    }),
    validate: (opts) => ensureOhlcvCoverageSchema.parse(opts),
    onError: die,
  });
}

/**
 * Register as package command module
 */
const ingestionModule: PackageCommandModule = {
  packageName: 'ingestion',
  description: 'Data ingestion operations',
  commands: [
    {
      name: 'telegram',
      description: 'Ingest Telegram export file',
      schema: telegramSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof telegramSchema>;
        return await ingestTelegramHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot ingestion telegram --file data/messages.html --caller-name Brook'],
    },
    {
      name: 'ohlcv',
      description: 'Fetch OHLCV data for calls',
      schema: ohlcvSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof ohlcvSchema>;
        return await ingestOhlcvHandler(typedArgs, typedCtx);
      },
      examples: ['quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01'],
    },
    {
      name: 'telegram-python',
      description: 'Process Telegram export using Python DuckDB pipeline',
      schema: telegramProcessSchema,
      handler: async (args: unknown, ctx: unknown): Promise<unknown> => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof telegramProcessSchema>;
        return await processTelegramPythonHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ingestion telegram-python --file data/telegram.json --output-db data/output.duckdb --chat-id test_chat',
      ],
    },
    {
      name: 'validate-addresses',
      description: 'Validate addresses and fetch metadata across chains',
      schema: validateAddressesSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof validateAddressesSchema>;
        return await validateAddressesHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ingestion validate-addresses 0x123... So111...',
        'quantbot ingestion validate-addresses 0x123... --chain-hint base',
      ],
    },
    {
      name: 'surgical-fetch',
      description: 'Surgical OHLCV fetching based on caller coverage analysis',
      schema: surgicalOhlcvFetchSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof surgicalOhlcvFetchSchema>;
        return await surgicalOhlcvFetchHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ingestion surgical-fetch --auto --limit 20',
        'quantbot ingestion surgical-fetch --caller Brook --month 2025-07',
        'quantbot ingestion surgical-fetch --caller Brook',
        'quantbot ingestion surgical-fetch --month 2025-07',
      ],
    },
    {
      name: 'ensure-coverage',
      description: 'Ensure OHLCV coverage for all tokens <3 months old',
      schema: ensureOhlcvCoverageSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof ensureOhlcvCoverageSchema>;
        return await ensureOhlcvCoverageHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot ingestion ensure-coverage',
        'quantbot ingestion ensure-coverage --max-age-days 60',
        'quantbot ingestion ensure-coverage --duckdb data/tele.duckdb',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(ingestionModule);
