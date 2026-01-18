/**
 * Migrate DuckDB Handler
 *
 * Runs SQL migration files against a DuckDB database
 */

import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve, join } from 'path';
import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/infra/utils';

export const migrateDuckdbSchema = z.object({
  duckdb: z.string().min(1, 'DuckDB path is required'),
  migration: z.string().optional(), // Specific migration file name (e.g., '006_create_backtest_tables.sql')
  all: z.boolean().optional(), // Run all migrations
});

export type MigrateDuckdbArgs = z.infer<typeof migrateDuckdbSchema>;

export async function migrateDuckdbHandler(
  args: MigrateDuckdbArgs,
  _ctx: CommandContext
): Promise<{ success: boolean; migrationsRun: string[]; error?: string }> {
  const duckdb = await import('duckdb');
  const duckdbPath = resolve(process.cwd(), args.duckdb);
  const database = new duckdb.Database(duckdbPath);
  const db = database.connect();

  const migrationsDir = join(process.cwd(), 'packages/storage/migrations');
  const migrationsRun: string[] = [];

  try {
    // Helper to run SQL with error handling
    const runSql = (sql: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        db.run(sql, [], (err: unknown) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    };

    if (args.migration) {
      // Run specific migration
      const migrationPath = join(migrationsDir, args.migration);
      const sql = readFileSync(migrationPath, 'utf-8');

      logger.info(`Running migration: ${args.migration}`, { duckdbPath });
      await runSql(sql);
      migrationsRun.push(args.migration);
    } else if (args.all) {
      // Run all migrations in order
      const { readdirSync } = await import('fs');
      const files = readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort(); // Run in alphabetical order (001, 002, etc.)

      for (const file of files) {
        const migrationPath = join(migrationsDir, file);
        const sql = readFileSync(migrationPath, 'utf-8');

        logger.info(`Running migration: ${file}`, { duckdbPath });
        await runSql(sql);
        migrationsRun.push(file);
      }
    } else {
      // Default: run backtest migration (most common use case)
      const migrationPath = join(migrationsDir, '006_create_backtest_tables.sql');
      const sql = readFileSync(migrationPath, 'utf-8');

      logger.info('Running backtest migration (006_create_backtest_tables.sql)', { duckdbPath });
      await runSql(sql);
      migrationsRun.push('006_create_backtest_tables.sql');
    }

    return {
      success: true,
      migrationsRun,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Migration failed', error as Error, { duckdbPath, migrationsRun });
    return {
      success: false,
      migrationsRun,
      error: errorMsg,
    };
  } finally {
    database.close();
  }
}
