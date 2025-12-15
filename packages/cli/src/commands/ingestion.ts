/**
 * Ingestion Commands
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { TelegramAlertIngestionService } from '@quantbot/ingestion';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { parseArguments } from '../core/argument-parser';
import { formatOutput } from '../core/output-formatter';
import { handleError } from '../core/error-handler';
import { createProgressIndicator } from '../core/output-formatter';
import type { PackageCommandModule } from '../types';
import { commandRegistry } from '../core/command-registry';

/**
 * Telegram ingestion schema
 */
const telegramSchema = z.object({
  file: z.string().min(1),
  callerName: z.string().min(1),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
  chatId: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * OHLCV ingestion schema
 */
const ohlcvSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preWindow: z.number().int().positive().default(260),
  postWindow: z.number().int().positive().default(1440),
  interval: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
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
      try {
        const args = parseArguments(telegramSchema, {
          ...options,
          file: options.file,
        });

        const service = new TelegramAlertIngestionService(
          new CallersRepository(),
          new TokensRepository(),
          new AlertsRepository(),
          new CallsRepository()
        );

        console.error('Processing Telegram export...');
        const result = await service.ingestExport({
          filePath: args.file,
          callerName: args.callerName,
          chain: args.chain,
          chatId: args.chatId,
        });

        const output = formatOutput(result, args.format);
        console.log(output);
        console.error('\n✅ Ingestion complete!');
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
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
      try {
        const args = parseArguments(ohlcvSchema, {
          ...options,
          preWindow: options.preWindow ? parseInt(options.preWindow, 10) : 260,
          postWindow: options.postWindow ? parseInt(options.postWindow, 10) : 1440,
        });

        const service = new OhlcvIngestionService(
          new CallsRepository(),
          new TokensRepository(),
          new AlertsRepository()
        );

        console.error('Fetching OHLCV data...');
        const result = await service.ingestForCalls({
          from: args.from ? new Date(args.from) : undefined,
          to: args.to ? new Date(args.to) : undefined,
          preWindowMinutes: args.preWindow,
          postWindowMinutes: args.postWindow,
        });

        const output = formatOutput(result, args.format);
        console.log(output);
        console.error('\n✅ OHLCV ingestion complete!');
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
const ingestionModule: PackageCommandModule = {
  packageName: 'ingestion',
  description: 'Data ingestion operations',
  commands: [
    {
      name: 'telegram',
      description: 'Ingest Telegram export file',
      schema: telegramSchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof telegramSchema>;
        const service = new TelegramAlertIngestionService(
          new CallersRepository(),
          new TokensRepository(),
          new AlertsRepository(),
          new CallsRepository()
        );
        return await service.ingestExport({
          filePath: args.file,
          callerName: args.callerName,
          chain: args.chain,
          chatId: args.chatId,
        });
      },
      examples: ['quantbot ingestion telegram --file data/messages.html --caller-name Brook'],
    },
    {
      name: 'ohlcv',
      description: 'Fetch OHLCV data for calls',
      schema: ohlcvSchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof ohlcvSchema>;
        const service = new OhlcvIngestionService(
          new CallsRepository(),
          new TokensRepository(),
          new AlertsRepository()
        );
        return await service.ingestForCalls({
          from: args.from ? new Date(args.from) : undefined,
          to: args.to ? new Date(args.to) : undefined,
          preWindowMinutes: args.preWindow,
          postWindowMinutes: args.postWindow,
        });
      },
      examples: ['quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(ingestionModule);
