#!/usr/bin/env node
/**
 * Migration Runner
 *
 * Usage:
 *   pnpm migrate:up          # Apply all pending migrations
 *   pnpm migrate:down        # Rollback last migration
 *   pnpm migrate:status      # Show current version
 *   pnpm migrate:history     # Show migration history
 *
 * Addresses: Risk #1 from ARCHITECTURE_REVIEW_2026-01-21.md
 */

import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { logger } from '@quantbot/utils';

// For now, use simple DuckDB operations until we export schema-version from @quantbot/storage
import duckdb from 'duckdb';

interface MigrationFile {
  version: number;
  name: string;
  filepath: string;
  checksum: string;
  upSql: string;
  downSql: string | null;
}

async function loadMigrations(migrationsDir: string): Promise<MigrationFile[]> {
  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql') && f.match(/^\d{3}_/));

  const migrations: MigrationFile[] = [];

  for (const file of sqlFiles) {
    const filepath = join(migrationsDir, file);
    const content = await readFile(filepath, 'utf-8');

    // Extract version from filename (e.g., "001_add_column.sql" → 1)
    const version = parseInt(file.substring(0, 3), 10);
    const name = file.substring(4).replace('.sql', '');

    // Calculate checksum
    const checksum = createHash('sha256').update(content).digest('hex');

    // Parse up/down migrations (simple convention: split on "-- Rollback:")
    const parts = content.split(/-- Rollback:|-- Down:/i);
    const upSql = parts[0]?.trim() ?? '';
    const downSql = parts[1]?.trim() || null;

    migrations.push({
      version,
      name,
      filepath,
      checksum,
      upSql,
      downSql,
    });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

async function migrateUp(duckdbPath: string): Promise<void> {
  console.log('🔄 Running migrations...\n');

  const db = new DuckDBClient({ dbPath: duckdbPath });

  try {
    // Initialize tracking table
    await initializeSchemaTracking(db as any);

    // Load all migration files
    const migrationsDir = join(process.cwd(), 'packages/storage/migrations');
    const migrations = await loadMigrations(migrationsDir);

    // Get current version
    const currentVersion = await getCurrentSchemaVersion(db as any, 'duckdb');
    console.log(`📌 Current version: ${currentVersion}`);

    // Find pending migrations
    const pending = migrations.filter((m) => m.version > currentVersion);

    if (pending.length === 0) {
      console.log('✅ No pending migrations');
      return;
    }

    console.log(`📦 Found ${pending.length} pending migration(s)\n`);

    // Apply each migration
    for (const migration of pending) {
      console.log(`⏳ Applying migration ${migration.version}: ${migration.name}...`);

      const startTime = Date.now();

      try {
        // Execute migration SQL
        await (db as any).run(migration.upSql);

        const executionTime = Date.now() - startTime;

        // Record migration
        await recordMigration(db as any, {
          version: migration.version,
          name: migration.name,
          description: `Migration from file: ${basename(migration.filepath)}`,
          database_type: 'duckdb',
          checksum: migration.checksum,
          execution_time_ms: executionTime,
          rollback_sql: migration.downSql,
        });

        console.log(`✅ Migration ${migration.version} applied (${executionTime}ms)\n`);
      } catch (error) {
        console.error(`❌ Migration ${migration.version} failed:`, error);
        throw error;
      }
    }

    const newVersion = await getCurrentSchemaVersion(db as any, 'duckdb');
    console.log(`\n🎉 Migrations complete! Version: ${currentVersion} → ${newVersion}`);
  } finally {
    // Note: DuckDBClient might need explicit close method
    // await db.close();
  }
}

async function migrateDown(duckdbPath: string): Promise<void> {
  console.log('🔄 Rolling back last migration...\n');

  const db = new DuckDBClient({ dbPath: duckdbPath });

  try {
    const currentVersion = await getCurrentSchemaVersion(db as any, 'duckdb');

    if (currentVersion === 0) {
      console.log('⚠️  Already at version 0, cannot rollback further');
      return;
    }

    // Get the migration to rollback
    const history = await getMigrationHistory(db as any, 'duckdb');
    const lastMigration = history.find(
      (m) => m.version === currentVersion && m.status === 'applied'
    );

    if (!lastMigration) {
      console.error(`❌ Migration ${currentVersion} not found or not applied`);
      return;
    }

    if (!lastMigration.rollback_sql) {
      console.error(`❌ Migration ${currentVersion} has no rollback SQL`);
      return;
    }

    console.log(`⏳ Rolling back migration ${currentVersion}: ${lastMigration.name}...`);

    const startTime = Date.now();

    try {
      // Execute rollback SQL
      await (db as any).run(lastMigration.rollback_sql);

      const executionTime = Date.now() - startTime;

      // Mark as rolled back
      await recordRollback(db as any, currentVersion, 'duckdb');

      console.log(`✅ Migration ${currentVersion} rolled back (${executionTime}ms)\n`);

      const newVersion = await getCurrentSchemaVersion(db as any, 'duckdb');
      console.log(`🎉 Rollback complete! Version: ${currentVersion} → ${newVersion}`);
    } catch (error) {
      console.error(`❌ Rollback ${currentVersion} failed:`, error);
      throw error;
    }
  } finally {
    // await db.close();
  }
}

async function showStatus(duckdbPath: string): Promise<void> {
  const db = new DuckDBClient({ dbPath: duckdbPath });

  try {
    await initializeSchemaTracking(db as any);

    const currentVersion = await getCurrentSchemaVersion(db as any, 'duckdb');
    const history = await getMigrationHistory(db as any, 'duckdb');

    console.log('📊 Schema Status\n');
    console.log(`Current version: ${currentVersion}`);
    console.log(`Total migrations: ${history.length}`);
    console.log(`Applied: ${history.filter((m) => m.status === 'applied').length}`);
    console.log(`Rolled back: ${history.filter((m) => m.status === 'rolled_back').length}\n`);
  } finally {
    // await db.close();
  }
}

async function showHistory(duckdbPath: string): Promise<void> {
  const db = new DuckDBClient({ dbPath: duckdbPath });

  try {
    await initializeSchemaTracking(db as any);

    const history = await getMigrationHistory(db as any, 'duckdb');

    console.log('📜 Migration History\n');
    console.table(
      history.map((m) => ({
        Version: m.version,
        Name: m.name,
        Status: m.status,
        Applied: m.applied_at.toISOString().substring(0, 19),
        Time: m.execution_time_ms ? `${m.execution_time_ms}ms` : '-',
      }))
    );
  } finally {
    // await db.close();
  }
}

// CLI
const command = process.argv[2];
const duckdbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';

(async () => {
  try {
    switch (command) {
      case 'up':
        await migrateUp(duckdbPath);
        break;
      case 'down':
        await migrateDown(duckdbPath);
        break;
      case 'status':
        await showStatus(duckdbPath);
        break;
      case 'history':
        await showHistory(duckdbPath);
        break;
      default:
        console.log(`
Usage: pnpm migrate <command>

Commands:
  up        Apply all pending migrations
  down      Rollback last migration
  status    Show current schema version
  history   Show migration history

Environment:
  DUCKDB_PATH   Path to DuckDB file (default: data/quantbot.duckdb)
        `);
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
})();
