/**
 * Validation Commands - Test and verify data pipeline components
 */

import { z } from 'zod';
import { Command } from 'commander';
import type { PackageCommandModule } from '../types/index.js';
import type { CommandContext } from '../core/command-context.js';
import { commandRegistry } from '../core/command-registry.js';
import { execute } from '../core/execute.js';
import { verifyOhlcvFetchHandler } from '../handlers/validation/verify-ohlcv-fetch.js';

// ============================================================================
// Schemas
// ============================================================================

export const verifyOhlcvFetchSchema = z.object({
  mint: z.string().describe('Token mint address'),
  fromDate: z.string().optional().describe('Start date (ISO 8601)'),
  toDate: z.string().optional().describe('End date (ISO 8601)'),
  hours: z.number().optional().describe('Hours back from now (if dates not specified)'),
  interval: z
    .enum(['1s', '15s', '1m', '5m', '15m', '1h'])
    .default('1m')
    .describe('Candle interval'),
  chain: z.string().default('solana').describe('Blockchain'),
  format: z.enum(['json', 'table']).default('table').describe('Output format'),
});

// ============================================================================
// Package Module Registration
// ============================================================================

const validationModule: PackageCommandModule = {
  packageName: 'validation',
  description: 'Validate data pipeline components',
  commands: [
    {
      name: 'verify-ohlcv-fetch',
      description: 'Test Birdeye API fetch for a single token',
      schema: verifyOhlcvFetchSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedArgs = args as z.infer<typeof verifyOhlcvFetchSchema>;
        return await verifyOhlcvFetchHandler(typedArgs, ctx as CommandContext);
      },
      examples: [
        'quantbot validation verify-ohlcv-fetch --mint So11111111111111111111111111111111111111112 --hours 1',
        'quantbot validation verify-ohlcv-fetch --mint <TOKEN> --from-date 2025-12-01T00:00:00Z --to-date 2025-12-01T01:00:00Z --interval 1m',
      ],
    },
  ],
};

// Register the package module (side effect)
commandRegistry.registerPackage(validationModule);

// ============================================================================
// Commander Registration
// ============================================================================

export function registerValidationCommands(program: Command): void {
  const validationCmd = program
    .command('validation')
    .description('Validate data pipeline components');

  // verify-ohlcv-fetch
  validationCmd
    .command('verify-ohlcv-fetch')
    .description('Test Birdeye API fetch for a single token')
    .requiredOption('--mint <address>', 'Token mint address')
    .option('--from-date <date>', 'Start date (ISO 8601)')
    .option('--to-date <date>', 'End date (ISO 8601)')
    .option('--hours <number>', 'Hours back from now', (val) => parseInt(val, 10))
    .option('--interval <interval>', 'Candle interval', '1m')
    .option('--chain <chain>', 'Blockchain', 'solana')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('validation', 'verify-ohlcv-fetch');
      if (!commandDef) {
        throw new Error('Command not found in registry');
      }
      await execute(commandDef, options);
    });
}
