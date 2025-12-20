/**
 * Storage Commands - Safe database queries
 */

import type { Command } from 'commander';
import { z } from 'zod';
// PostgreSQL removed - getPostgresPool no longer available
// getClickHouseClient should be accessed through CommandContext factory
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { NotFoundError, ValidationError } from '@quantbot/utils';
import { queryStorageHandler } from '../handlers/storage/query-storage.js';
import { statsStorageHandler } from '../handlers/storage/stats-storage.js';
import { listTokensHandler } from '../handlers/storage/list-tokens.js';
import { storageStatsWorkflowHandler } from '../handlers/storage/stats-workflow.js';
import { ohlcvStatsWorkflowHandler } from '../handlers/storage/ohlcv-stats-workflow.js';
import { tokenStatsWorkflowHandler } from '../handlers/storage/token-stats-workflow.js';

/**
 * Query command schema - Only allow safe queries
 */
export const querySchema = z.object({
  table: z.string().min(1),
  limit: z.number().int().positive().max(10000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  // Note: WHERE clauses are not supported via CLI for security
  // Users should use package-specific commands for filtered queries
});

/**
 * List tokens command schema
 */
export const listTokensSchema = z.object({
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(),
  source: z.enum(['ohlcv', 'metadata']).default('ohlcv'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  limit: z.number().int().positive().max(10000).default(1000),
});

/**
 * Storage stats workflow schema
 */
export const storageStatsWorkflowSchema = z.object({
  source: z.enum(['clickhouse', 'duckdb', 'all']).default('all'),
  includeTableSizes: z.boolean().default(true),
  includeRowCounts: z.boolean().default(true),
  includeDateRanges: z.boolean().default(true),
  duckdbPath: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * OHLCV stats workflow schema
 */
export const ohlcvStatsWorkflowSchema = z.object({
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).optional(),
  mint: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Token stats workflow schema
 */
export const tokenStatsWorkflowSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(),
  duckdbPath: z.string().optional(),
  limit: z.number().int().positive().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Safe table names (whitelist to prevent SQL injection)
 */
export const SAFE_TABLES = {
  postgres: [
    'tokens',
    'calls',
    'alerts',
    'callers',
    'strategies',
    'simulation_runs',
    'simulation_results_summary',
  ],
  clickhouse: [
    'ohlcv_candles',
    'indicator_values',
    'simulation_events',
    'simulation_aggregates',
    'token_metadata',
  ],
};

/**
 * Validate table name to prevent SQL injection
 */
function validateTableName(table: string, database: 'postgres' | 'clickhouse'): boolean {
  const safeTables = SAFE_TABLES[database];
  return safeTables.includes(table.toLowerCase());
}

/**
 * Query Postgres table safely
 * @deprecated PostgreSQL removed - this function no longer works
 */
export async function queryPostgresTable(_table: string, _limit: number): Promise<unknown[]> {
  throw new ValidationError('PostgreSQL removed - use DuckDB instead', {
    table: _table,
    limit: _limit,
  });
}

/**
 * Query ClickHouse table safely
 * @deprecated Use CommandContext.services.clickHouseClient() instead
 * This function is kept for backward compatibility but should not be used in new code
 */
export async function queryClickHouseTable(table: string, limit: number): Promise<unknown[]> {
  if (!validateTableName(table, 'clickhouse')) {
    throw new ValidationError(
      `Invalid table name: ${table}. Allowed tables: ${SAFE_TABLES.clickhouse.join(', ')}`,
      { table, database: 'clickhouse', allowedTables: SAFE_TABLES.clickhouse }
    );
  }

  // This function should not be used - handlers should use CommandContext factory
  // Keeping for backward compatibility only
  const { getClickHouseClient } = await import('@quantbot/storage');
  const client = getClickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Use parameterized query
  const result = await client.query({
    query: `SELECT * FROM ${database}.${table} LIMIT {limit:UInt32}`,
    query_params: { limit },
    format: 'JSONEachRow',
  });

  const data = await result.json<Record<string, unknown>[]>();
  return data;
}

/**
 * Register storage commands
 */
export function registerStorageCommands(program: Command): void {
  const storageCmd = program
    .command('storage')
    .description('Database storage operations (safe queries only)');

  // Query command
  storageCmd
    .command('query')
    .description('Query database tables (safe, read-only)')
    .requiredOption('--table <table>', 'Table name')
    .option('--limit <limit>', 'Maximum rows to return', '100')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('storage', 'query');
      if (!commandDef) {
        throw new NotFoundError('Command', 'storage.query');
      }
      await execute(commandDef, {
        ...options,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    });

  // Stats command
  storageCmd
    .command('stats')
    .description('Show database statistics')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('storage', 'stats');
      if (!commandDef) {
        throw new NotFoundError('Command', 'storage.stats');
      }
      await execute(commandDef, options);
    });

  // List tokens command
  storageCmd
    .command('tokens')
    .description('List unique tokens from ClickHouse')
    .option('--chain <chain>', 'Blockchain (solana, ethereum, bsc, base)', 'solana')
    .option('--source <source>', 'Data source (ohlcv, metadata)', 'ohlcv')
    .option('--limit <limit>', 'Maximum tokens to return', '1000')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('storage', 'tokens');
      if (!commandDef) {
        throw new NotFoundError('Command', 'storage.tokens');
      }
      await execute(commandDef, {
        ...options,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    });

  // Stats workflow command (comprehensive stats using workflow)
  storageCmd
    .command('stats-workflow')
    .description('Get comprehensive storage statistics using workflow (ClickHouse + DuckDB)')
    .option('--source <source>', 'Data source (clickhouse, duckdb, all)', 'all')
    .option('--no-include-table-sizes', 'Exclude table sizes')
    .option('--no-include-row-counts', 'Exclude row counts')
    .option('--no-include-date-ranges', 'Exclude date ranges')
    .option('--duckdb-path <path>', 'DuckDB file path')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('storage', 'stats-workflow');
      if (!commandDef) {
        throw new NotFoundError('Command', 'storage.stats-workflow');
      }
      await execute(commandDef, {
        ...options,
        includeTableSizes: options.includeTableSizes !== false,
        includeRowCounts: options.includeRowCounts !== false,
        includeDateRanges: options.includeDateRanges !== false,
      });
    });

  // OHLCV stats workflow command
  storageCmd
    .command('ohlcv-stats')
    .description('Get comprehensive OHLCV statistics using workflow')
    .option('--chain <chain>', 'Filter by chain (solana, ethereum, bsc, base)')
    .option('--interval <interval>', 'Filter by interval (1m, 5m, 15m, 1h, 4h, 1d)')
    .option('--mint <address>', 'Filter by token mint address')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('storage', 'ohlcv-stats');
      if (!commandDef) {
        throw new NotFoundError('Command', 'storage.ohlcv-stats');
      }
      await execute(commandDef, options);
    });

  // Token stats workflow command
  storageCmd
    .command('token-stats')
    .description(
      'Get comprehensive token statistics combining DuckDB calls with ClickHouse OHLCV and simulations'
    )
    .option('--from <date>', 'Start date (ISO 8601)')
    .option('--to <date>', 'End date (ISO 8601)')
    .option('--chain <chain>', 'Filter by chain (solana, ethereum, bsc, base)')
    .option('--duckdb-path <path>', 'DuckDB file path')
    .option('--limit <limit>', 'Maximum tokens to return', parseInt)
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      const { execute } = await import('../core/execute.js');
      const commandDef = commandRegistry.getCommand('storage', 'token-stats');
      if (!commandDef) {
        throw new NotFoundError('Command', 'storage.token-stats');
      }
      await execute(commandDef, {
        ...options,
        limit: options.limit ? parseInt(options.limit, 10) : undefined,
      });
    });
}

/**
 * Register as package command module
 */
const storageModule: PackageCommandModule = {
  packageName: 'storage',
  description: 'Database storage operations (safe queries only)',
  commands: [
    {
      name: 'query',
      description: 'Query database tables (safe, read-only)',
      schema: querySchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof querySchema>;
        return await queryStorageHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot storage query --table tokens --limit 10',
        'quantbot storage query --table ohlcv_candles --limit 100 --format json',
      ],
    },
    {
      name: 'stats',
      description: 'Show database statistics',
      schema: z.object({
        format: z.enum(['json', 'table', 'csv']).default('table'),
      }),
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        return await statsStorageHandler(args as { format?: 'json' | 'table' | 'csv' }, typedCtx);
      },
      examples: ['quantbot storage stats'],
    },
    {
      name: 'tokens',
      description: 'List unique tokens from ClickHouse',
      schema: listTokensSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof listTokensSchema>;
        return await listTokensHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot storage tokens',
        'quantbot storage tokens --chain solana --source ohlcv --limit 100',
        'quantbot storage tokens --chain ethereum --source metadata --format json',
      ],
    },
    {
      name: 'stats-workflow',
      description: 'Get comprehensive storage statistics using workflow (ClickHouse + DuckDB)',
      schema: storageStatsWorkflowSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof storageStatsWorkflowSchema>;
        return await storageStatsWorkflowHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot storage stats-workflow',
        'quantbot storage stats-workflow --source clickhouse',
        'quantbot storage stats-workflow --source all --duckdb-path data/tele.duckdb',
        'quantbot storage stats-workflow --no-include-date-ranges --format json',
      ],
    },
    {
      name: 'ohlcv-stats',
      description: 'Get comprehensive OHLCV statistics using workflow',
      schema: ohlcvStatsWorkflowSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof ohlcvStatsWorkflowSchema>;
        return await ohlcvStatsWorkflowHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot storage ohlcv-stats',
        'quantbot storage ohlcv-stats --chain solana',
        'quantbot storage ohlcv-stats --interval 5m --format json',
        'quantbot storage ohlcv-stats --mint So11111111111111111111111111111111111111112',
      ],
    },
    {
      name: 'token-stats',
      description:
        'Get comprehensive token statistics combining DuckDB calls with ClickHouse OHLCV and simulations',
      schema: tokenStatsWorkflowSchema,
      handler: async (args: unknown, ctx: unknown) => {
        const typedCtx = ctx as CommandContext;
        const typedArgs = args as z.infer<typeof tokenStatsWorkflowSchema>;
        return await tokenStatsWorkflowHandler(typedArgs, typedCtx);
      },
      examples: [
        'quantbot storage token-stats',
        'quantbot storage token-stats --from 2024-01-01 --to 2024-12-31',
        'quantbot storage token-stats --chain solana --limit 100',
        'quantbot storage token-stats --duckdb-path data/tele.duckdb --format json',
      ],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(storageModule);
