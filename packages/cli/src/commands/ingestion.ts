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
import { ingestOhlcvHandler } from '../handlers/ingestion/ingest-ohlcv.js';
import type { CommandContext } from '../core/command-context.js';
import { ingestTelegramHandler } from '../handlers/ingestion/ingest-telegram.js';
import { processTelegramPythonHandler } from '../handlers/ingestion/process-telegram-python.js';

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
  interval: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Telegram Python pipeline schema
 */
export const telegramProcessSchema = z.object({
  file: z.string().min(1),
  outputDb: z.string().min(1),
  chatId: z.string().min(1),
  rebuild: z.boolean().default(false),
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
        throw new Error('Command ingestion telegram not found in registry');
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
    .option('--interval <interval>', 'Candle interval', '5m')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ingestion', 'ohlcv');
      if (!commandDef) {
        throw new Error('Command ingestion ohlcv not found in registry');
      }
      await execute(commandDef, options);
    });

  // Telegram Python pipeline
  ingestionCmd
    .command('telegram-python')
    .description('Process Telegram export using Python DuckDB pipeline')
    .requiredOption('--file <path>', 'Path to Telegram JSON export file')
    .requiredOption('--output-db <path>', 'Output DuckDB file path')
    .requiredOption('--chat-id <id>', 'Chat ID')
    .option('--rebuild', 'Rebuild database', false)
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('ingestion', 'telegram-python');
      if (!commandDef) {
        throw new Error('Command ingestion telegram-python not found in registry');
      }
      await execute(commandDef, {
        ...options,
        rebuild: options.rebuild === true || options.rebuild === 'true',
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
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof telegramSchema>;
        return await ingestTelegramHandler(typedArgs, ctx);
      },
      examples: ['quantbot ingestion telegram --file data/messages.html --caller-name Brook'],
    },
    {
      name: 'ohlcv',
      description: 'Fetch OHLCV data for calls',
      schema: ohlcvSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof ohlcvSchema>;
        return await ingestOhlcvHandler(typedArgs, ctx);
      },
      examples: ['quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01'],
    },
    {
      name: 'telegram-python',
      description: 'Process Telegram export using Python DuckDB pipeline',
      schema: telegramProcessSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof telegramProcessSchema>;
        return await processTelegramPythonHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot ingestion telegram-python --file data/telegram.json --output-db data/output.duckdb --chat-id test_chat',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(ingestionModule);
