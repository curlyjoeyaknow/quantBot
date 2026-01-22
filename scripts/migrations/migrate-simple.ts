#!/usr/bin/env node
/**
 * Simple Migration Runner (using duckdb directly)
 *
 * Usage:
 *   pnpm migrate:up          # Apply all pending migrations
 *   pnpm migrate:status      # Show current version
 *
 * Addresses: Risk #1 from ARCHITECTURE_REVIEW_2026-01-21.md
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { createHash } from 'crypto';
import duckdb from 'duckdb';

interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = await readdir(dir);
  const sqlFiles = files.filter((f) => f.endsWith('.sql') && f.match(/^\d{3}_/));

  const migrations: Migration[] = [];

  for (const file of sqlFiles) {
    const filepath = join(dir, file);
    const sql = await readFile(filepath, 'utf-8');
    const version = parseInt(file.substring(0, 3), 10);
    const name = file.substring(4).replace('.sql', '');
    const checksum = createHash('sha256').update(sql).digest('hex');

    migrations.push({ version, name, sql, checksum });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

async function getCurrentVersion(db: duckdb.Database): Promise<number> {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT MAX(version) as current_version 
       FROM schema_migrations 
       WHERE database_type = 'duckdb' 
         AND status = 'applied'`,
      (err, rows: any[]) => {
        if (err) {
          // Table doesn't exist, we're at version 0
          resolve(0);
        } else {
          resolve(rows[0]?.current_version ?? 0);
        }
      }
    );
  });
}

async function applyMigration(db: duckdb.Database, migration: Migration): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    db.exec(migration.sql, (err) => {
      if (err) {
        reject(err);
      } else {
        const executionTime = Date.now() - startTime;

        // Record migration
        db.run(
          `INSERT INTO schema_migrations 
           (version, name, description, database_type, checksum, execution_time_ms, status)
           VALUES (?, ?, ?, 'duckdb', ?, ?, 'applied')`,
          [
            migration.version,
            migration.name,
            `Migration: ${migration.name}`,
            migration.checksum,
            executionTime,
          ],
          (err2) => {
            if (err2) {
              reject(err2);
            } else {
              resolve();
            }
          }
        );
      }
    });
  });
}

async function migrateUp(duckdbPath: string): Promise<void> {
  console.log('🔄 Running migrations...\n');

  const db = new duckdb.Database(duckdbPath);

  try {
    const currentVersion = await getCurrentVersion(db);
    console.log(`📌 Current version: ${currentVersion}`);

    const migrationsDir = join(process.cwd(), 'packages/storage/migrations');
    const migrations = await loadMigrations(migrationsDir);

    const pending = migrations.filter((m) => m.version > currentVersion);

    if (pending.length === 0) {
      console.log('✅ No pending migrations');
      db.close();
      return;
    }

    console.log(`📦 Found ${pending.length} pending migration(s)\n`);

    for (const migration of pending) {
      console.log(`⏳ Applying migration ${migration.version}: ${migration.name}...`);

      try {
        await applyMigration(db, migration);
        console.log(`✅ Migration ${migration.version} applied\n`);
      } catch (error) {
        console.error(`❌ Migration ${migration.version} failed:`, error);
        db.close();
        throw error;
      }
    }

    const newVersion = await getCurrentVersion(db);
    console.log(`\n🎉 Migrations complete! Version: ${currentVersion} → ${newVersion}`);

    db.close();
  } catch (error) {
    db.close();
    throw error;
  }
}

async function showStatus(duckdbPath: string): Promise<void> {
  const db = new duckdb.Database(duckdbPath);

  try {
    const currentVersion = await getCurrentVersion(db);
    console.log(`\n📊 Schema Status`);
    console.log(`Database: ${duckdbPath}`);
    console.log(`Current version: ${currentVersion}\n`);
    db.close();
  } catch (error) {
    db.close();
    throw error;
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
      case 'status':
        await showStatus(duckdbPath);
        break;
      default:
        console.log(`
Usage: pnpm migrate:<command>

Commands:
  up        Apply all pending migrations
  status    Show current schema version

Environment:
  DUCKDB_PATH   Path to DuckDB file (default: data/quantbot.duckdb)
        `);
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
})();
