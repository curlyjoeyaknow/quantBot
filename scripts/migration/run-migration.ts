#!/usr/bin/env ts-node

/**
 * Run a database migration
 */

import { getPostgresPool } from '@quantbot/storage';
import * as fs from 'fs';
import * as path from 'path';

async function runMigration(migrationFile: string): Promise<void> {
  const migrationPath = path.join(process.cwd(), migrationFile);
  if (!fs.existsSync(migrationPath)) {
    console.error(`Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  const pool = getPostgresPool();

  try {
    await pool.query(sql);
    console.log(`✅ Migration applied: ${migrationFile}`);
  } catch (error) {
    console.error(`❌ Migration failed: ${migrationFile}`, error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: ts-node scripts/migration/run-migration.ts <migration-file>');
  process.exit(1);
}

runMigration(migrationFile);
