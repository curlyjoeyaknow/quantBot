/**
 * Storage Commands - Safe database queries
 */

import type { Command } from 'commander';
import { z } from 'zod';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { parseArguments } from '../core/argument-parser';
import { formatOutput } from '../core/output-formatter';
import { handleError } from '../core/error-handler';
import type { PackageCommandModule } from '../types';
import { commandRegistry } from '../core/command-registry';

/**
 * Query command schema - Only allow safe queries
 */
const querySchema = z.object({
  table: z.string().min(1),
  limit: z.number().int().positive().max(10000).default(100),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  // Note: WHERE clauses are not supported via CLI for security
  // Users should use package-specific commands for filtered queries
});

/**
 * Safe table names (whitelist to prevent SQL injection)
 */
const SAFE_TABLES = {
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
async function queryPostgresTable(table: string, limit: number): Promise<unknown[]> {
  if (!validateTableName(table, 'postgres')) {
    throw new Error(
      `Invalid table name: ${table}. Allowed tables: ${SAFE_TABLES.postgres.join(', ')}`
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
async function queryClickHouseTable(table: string, limit: number): Promise<unknown[]> {
  if (!validateTableName(table, 'clickhouse')) {
    throw new Error(
      `Invalid table name: ${table}. Allowed tables: ${SAFE_TABLES.clickhouse.join(', ')}`
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
      try {
        const args = parseArguments(querySchema, {
          ...options,
          limit: parseInt(options.limit, 10),
        });

        // Determine database type from table name
        const isClickHouse = SAFE_TABLES.clickhouse.includes(args.table.toLowerCase());
        const isPostgres = SAFE_TABLES.postgres.includes(args.table.toLowerCase());

        if (!isClickHouse && !isPostgres) {
          throw new Error(
            `Table ${args.table} not found in allowed tables. Use --help to see available tables.`
          );
        }

        // Query appropriate database
        let data: unknown[];
        if (isClickHouse) {
          data = await queryClickHouseTable(args.table, args.limit);
        } else {
          data = await queryPostgresTable(args.table, args.limit);
        }

        // Format output
        const output = formatOutput(data, args.format);
        console.log(output);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });

  // Stats command
  storageCmd
    .command('stats')
    .description('Show database statistics')
    .option('--format <format>', 'Output format', 'table')
    .action(async (options) => {
      try {
        const format = options.format || 'table';

        // Get stats from both databases
        const stats: Record<string, unknown> = {};

        // Postgres stats
        try {
          const pool = getPostgresPool();
          const tables = SAFE_TABLES.postgres;
          const counts: Record<string, number> = {};

          for (const table of tables) {
            const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
            counts[table] = parseInt(result.rows[0]?.count ?? '0', 10);
          }

          stats.postgres = counts;
        } catch (error) {
          stats.postgres = { error: (error as Error).message };
        }

        // ClickHouse stats
        try {
          const client = getClickHouseClient();
          const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
          const tables = SAFE_TABLES.clickhouse;
          const counts: Record<string, number> = {};

          for (const table of tables) {
            const result = await client.query({
              query: `SELECT COUNT(*) as count FROM ${database}.${table}`,
              format: 'JSONEachRow',
            });
            const data = await result.json<{ count: string }[]>();
            counts[table] = parseInt(data[0]?.count ?? '0', 10);
          }

          stats.clickhouse = counts;
        } catch (error) {
          stats.clickhouse = { error: (error as Error).message };
        }

        // Format output
        const output = formatOutput(stats, format);
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
const storageModule: PackageCommandModule = {
  packageName: 'storage',
  description: 'Database storage operations (safe queries only)',
  commands: [
    {
      name: 'query',
      description: 'Query database tables (safe, read-only)',
      schema: querySchema,
      handler: async (args: unknown) => {
        const typedArgs = args as z.infer<typeof querySchema>;
        const isClickHouse = SAFE_TABLES.clickhouse.includes(typedArgs.table.toLowerCase());
        if (isClickHouse) {
          return await queryClickHouseTable(typedArgs.table, typedArgs.limit);
        }
        return await queryPostgresTable(typedArgs.table, typedArgs.limit);
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
      handler: async () => {
        // Stats implementation (same as above)
        return { message: 'Stats command - implementation in progress' };
      },
      examples: ['quantbot storage stats'],
    },
  ],
};

// Register the module
commandRegistry.registerPackage(storageModule);
