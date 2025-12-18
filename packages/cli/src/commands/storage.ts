/**
 * Storage Commands - Safe database queries
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import type { PackageCommandModule } from '../types/index.js';
import { commandRegistry } from '../core/command-registry.js';
import type { CommandContext } from '../core/command-context.js';
import { NotFoundError, ValidationError } from '@quantbot/utils';
import { queryStorageHandler } from '../handlers/storage/query-storage.js';
import { statsStorageHandler } from '../handlers/storage/stats-storage.js';

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
    'token_metadata_snapshots',
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
 */
export async function queryPostgresTable(table: string, limit: number): Promise<unknown[]> {
  if (!validateTableName(table, 'postgres')) {
    throw new ValidationError(
      `Invalid table name: ${table}. Allowed tables: ${SAFE_TABLES.postgres.join(', ')}`,
      { table, database: 'postgres', allowedTables: SAFE_TABLES.postgres }
    );
  }

  const pool = getPostgresPool();
  // Use parameterized query to prevent SQL injection
  const result = await pool.query(`SELECT * FROM ${table} LIMIT $1`, [limit]);

  return result.rows;
}

/**
 * Query ClickHouse table safely
 */
export async function queryClickHouseTable(table: string, limit: number): Promise<unknown[]> {
  if (!validateTableName(table, 'clickhouse')) {
    throw new ValidationError(
      `Invalid table name: ${table}. Allowed tables: ${SAFE_TABLES.clickhouse.join(', ')}`,
      { table, database: 'clickhouse', allowedTables: SAFE_TABLES.clickhouse }
    );
  }

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
  ],
};

// Register the module
commandRegistry.registerPackage(storageModule);
