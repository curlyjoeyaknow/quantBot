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
import { ingestOhlcvHandler } from './ingestion/ingest-ohlcv.js';
import type { CommandContext } from '../core/command-context.js';
import { ingestTelegramHandler } from './ingestion/ingest-telegram.js';
import { processTelegramPythonHandler } from './ingestion/process-telegram-python.js';
import { validateAddressesHandler } from './ingestion/validate-addresses.js';
import { surgicalOhlcvFetchHandler } from './ingestion/surgical-ohlcv-fetch.js';
import { NotFoundError } from '@quantbot/utils';

/**
 * Telegram ingestion schema
 */
export const telegramSchema = z.object({
  file: z.string().min(1),
  callerName: z.string().min(1),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
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
  chainHint: z.enum(['solana', 'ethereum', 'base', 'bsc']).optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Register ingestion commands
 */
export function registerIngestionCommands(program: Command): void {
  const ingestionCmd = program.command('ingestion').description('Data ingestion operations');

  // Telegram ingestion
  ingestionCmd
    .command('telegram')
    .description('Ingest Telegram export file')
    .requiredOption('--file <path>', 'Path to Telegram HTML export file')
    .requiredOption('--caller-name <name>', 'Caller name (e.g., Brook, Lsy)')
    .option('--chain <chain>', 'Blockchain', 'solana')
    .option('--chat-id <id>', 'Chat ID (optional)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ingestion', 'telegram');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ingestion.telegram');
      }
      await execute(commandDef, options);
    });

  // OHLCV ingestion
  ingestionCmd
    .command('ohlcv')
    .description('Fetch OHLCV data for calls')
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--pre-window <minutes>', 'Pre-window minutes', '260')
    .option('--post-window <minutes>', 'Post-window minutes', '1440')
    .option('--interval <interval>', 'Candle interval (1s, 15s, 1m, 5m, 15m, 1h)', '1m')
    .option('--tui', 'Run with interactive TUI', false)
    .option('--candles <number>', 'Number of candles to fetch', '5000')
    .option('--start-offset-minutes <number>', 'Minutes before alert to start fetching', '-52')
    .option('--format <format>', 'Output format', 'table')
    .option('--duckdb <path>', 'Path to DuckDB database file (or set DUCKDB_PATH env var)')
    .action(async (options) => {
      // Normalize numeric options from strings to numbers (Commander.js passes all as strings)
      const normalizedOptions = {
        ...options,
        preWindow: options.preWindow ? Number(options.preWindow) : undefined,
        postWindow: options.postWindow ? Number(options.postWindow) : undefined,
        candles: options.candles ? Number(options.candles) : undefined,
        startOffsetMinutes: options.startOffsetMinutes
          ? Number(options.startOffsetMinutes)
          : undefined,
      };

      if (options.tui) {
        // Run with TUI
        const { runOhlcvIngestionWithTui } = await import('./ingestion/run-ohlcv-with-tui.js');
        const typedArgs = ohlcvSchema.parse(normalizedOptions);
        await runOhlcvIngestionWithTui(typedArgs);
      } else {
        // Run normally
        const { execute } = await import('../core/execute.js');
        const commandDef = commandRegistry.getCommand('ingestion', 'ohlcv');
        if (!commandDef) {
          throw new NotFoundError('Command', 'ingestion.ohlcv');
        }
        await execute(commandDef, normalizedOptions);
      }
    });

  // Telegram Python pipeline
  ingestionCmd
    .command('telegram-python')
    .description('Process Telegram export using Python DuckDB pipeline')
    .requiredOption('--file <path>', 'Path to Telegram JSON export file')
    .requiredOption('--output-db <path>', 'Output DuckDB file path')
    .option('--chat-id <id>', 'Chat ID (optional - will be extracted from file if single chat)')
    .option('--rebuild', 'Rebuild database', false)
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ingestion', 'telegram-python');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ingestion.telegram-python');
      }
      // Commander.js already converts --output-db to outputDb automatically
      // normalizeOptions only normalizes values, not keys
      await execute(commandDef, {
        ...options,
        rebuild: options.rebuild === true || options.rebuild === 'true',
      });
    });

  // Address validation
  ingestionCmd
    .command('validate-addresses')
    .description('Validate addresses and fetch metadata across chains')
    .argument('<addresses...>', 'Addresses to validate (space-separated)')
    .option('--chain-hint <chain>', 'Chain hint (solana, ethereum, base, bsc)')
    .option('--format <format>', 'Output format', 'table')
    .action(async (addresses: string[], options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ingestion', 'validate-addresses');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ingestion.validate-addresses');
      }
      await execute(commandDef, { ...options, addresses });
    });

  // Surgical OHLCV fetch
  ingestionCmd
    .command('surgical-fetch')
    .description('Surgical OHLCV fetching based on caller coverage analysis')
    .option('--duckdb <path>', 'Path to DuckDB database')
    .option('--interval <interval>', 'OHLCV interval', '5m')
    .option('--caller <name>', 'Specific caller to fetch for')
    .option('--month <YYYY-MM>', 'Specific month to fetch for')
    .option('--start-month <YYYY-MM>', 'Start month for analysis')
    .option('--end-month <YYYY-MM>', 'End month for analysis')
    .option('--auto', 'Automatically fetch for top priority gaps')
    .option('--limit <number>', 'Limit number of tasks in auto mode', '10')
    .option('--min-coverage <ratio>', 'Minimum coverage threshold (0-1)', '0.8')
    .option('--dry-run', 'Show what would be fetched without actually fetching')
    .option('--verbose', 'Show verbose progress output and progress bars')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      console.error('[ACTION START] surgical-fetch action called');
      console.error('[ACTION] options.verbose:', options.verbose, typeof options.verbose);
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ingestion', 'surgical-fetch');
      if (!commandDef) {
        throw new NotFoundError('Command', 'ingestion.surgical-fetch');
      }
      // Debug: Check verbose flag
      const verboseFlag = options.verbose === true || options.verbose === 'true';
      if (verboseFlag) {
        console.error('[DEBUG] Verbose flag detected in action handler');
      }
      await execute(commandDef, {
        ...options,
        auto: options.auto === true || options.auto === 'true',
        dryRun: options.dryRun === true || options.dryRun === 'true',
        verbose: verboseFlag,
        limit: options.limit ? parseInt(options.limit) : 10,
        minCoverage: options.minCoverage ? parseFloat(options.minCoverage) : 0.8,
      });
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
  ],
};

// Register the module
commandRegistry.registerPackage(ingestionModule);
