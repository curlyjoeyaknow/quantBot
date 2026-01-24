/**
 * Canonical Events Commands
 */

import type { Command } from 'commander';
import { defineCommand } from '../../core/defineCommand.js';
import { die } from '../../core/cliErrors.js';
import { commandRegistry } from '../../core/command-registry.js';
import type { PackageCommandModule } from '../../types/index.js';
import { canonicalQuerySchema, canonicalGetByAssetSchema } from '../../command-defs/data.js';
import { queryCanonicalHandler } from '../../handlers/data/query-canonical.js';
import { getCanonicalByAssetHandler } from '../../handlers/data/get-canonical-by-asset.js';

/**
 * Register canonical events commands
 */
export function registerCanonicalCommands(program: Command): void {
  const dataCmd = program.command('data').description('Data operations');

  const canonicalCmd = dataCmd
    .command('canonical')
    .description('Canonical events operations (unified market data)');

  // Query canonical events
  const queryCmd = canonicalCmd
    .command('query')
    .description('Query canonical events')
    .option('--asset-address <address>', 'Filter by asset address')
    .option('--chain <chain>', 'Filter by chain (solana, ethereum, bsc, base, evm)')
    .option('--venue-name <name>', 'Filter by venue name')
    .option('--venue-type <type>', 'Filter by venue type (dex, cex, data_provider, social, on_chain)')
    .option('--event-type <type>', 'Filter by event type (price, trade, alert, candle, volume, liquidity, metadata)')
    .option('--from <date>', 'Filter by timestamp (from, ISO 8601)')
    .option('--to <date>', 'Filter by timestamp (to, ISO 8601)')
    .option('--source-hash <hash>', 'Filter by source hash')
    .option('--source-run-id <id>', 'Filter by source run ID')
    .option('--limit <number>', 'Limit number of results', parseInt)
    .option('--offset <number>', 'Offset for pagination', parseInt)
    .option('--format <format>', 'Output format', 'table');

  defineCommand(queryCmd, {
    name: 'query',
    packageName: 'data.canonical',
    validate: (opts) => canonicalQuerySchema.parse(opts),
    onError: die,
    handler: queryCanonicalHandler,
  });

  // Get events by asset
  const getByAssetCmd = canonicalCmd
    .command('get-by-asset')
    .description('Get canonical events for a specific asset (chain-agnostic)')
    .requiredOption('--asset-address <address>', 'Asset address')
    .option('--from <date>', 'Filter by timestamp (from, ISO 8601)')
    .option('--to <date>', 'Filter by timestamp (to, ISO 8601)')
    .option('--event-types <types>', 'Comma-separated event types to filter')
    .option('--format <format>', 'Output format', 'table');

  defineCommand(getByAssetCmd, {
    name: 'get-by-asset',
    packageName: 'data.canonical',
    validate: (opts) => {
      // Parse comma-separated event types
      if (opts['event-types']) {
        opts.eventTypes = (opts['event-types'] as string).split(',').map((s) => s.trim());
      }
      return canonicalGetByAssetSchema.parse(opts);
    },
    onError: die,
    handler: getCanonicalByAssetHandler,
  });
}

/**
 * Register as package command module
 */
const canonicalModule: PackageCommandModule = {
  packageName: 'data.canonical',
  description: 'Canonical events operations (unified market data)',
  commands: [
    {
      name: 'query',
      description: 'Query canonical events',
      schema: canonicalQuerySchema,
      handler: queryCanonicalHandler,
      examples: [
        'quantbot data canonical query --asset-address ABC123...',
        'quantbot data canonical query --chain solana --event-type alert',
        'quantbot data canonical query --from 2024-01-01 --to 2024-12-31',
      ],
    },
    {
      name: 'get-by-asset',
      description: 'Get canonical events for a specific asset',
      schema: canonicalGetByAssetSchema,
      handler: getCanonicalByAssetHandler,
      examples: [
        'quantbot data canonical get-by-asset --asset-address ABC123...',
        'quantbot data canonical get-by-asset --asset-address ABC123... --event-types alert,candle',
      ],
    },
  ],
};

commandRegistry.registerPackage(canonicalModule);

