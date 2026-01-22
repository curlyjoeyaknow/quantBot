#!/usr/bin/env tsx
/**
 * CI Check: Schema Versioning
 *
 * Verifies that schema changes are properly versioned:
 * - SQL files in tools/storage/migrations/ or tools/telegram/ must have version numbers
 * - Migration files must follow naming pattern: NNN_description.sql
 * - Checks that schema_version table exists in migration files
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

const MIGRATION_DIRS = ['tools/storage/migrations', 'tools/telegram'];

const MIGRATION_FILE_PATTERN = /^(\d+)_(.+)\.(sql|py)$/;

interface MigrationFile {
  path: string;
  version: number;
  name: string;
  content: string;
}

async function findMigrationFiles(): Promise<MigrationFile[]> {
  const migrations: MigrationFile[] = [];

  for (const dir of MIGRATION_DIRS) {
    if (!existsSync(dir)) {
      continue;
    }

    const files = await readdir(dir);
    for (const file of files) {
      const match = file.match(MIGRATION_FILE_PATTERN);
      if (match) {
        const [, versionStr, name] = match;
        const version = parseInt(versionStr, 10);
        const path = join(dir, file);
        const content = await readFile(path, 'utf-8');
        migrations.push({ path, version, name, content });
      }
    }
  }

  return migrations.sort((a, b) => a.version - b.version);
}

function checkMigrationFile(migration: MigrationFile): string[] {
  const errors: string[] = [];

  // Check SQL files contain schema_version references
  if (migration.path.endsWith('.sql')) {
    if (!migration.content.includes('schema_version')) {
      errors.push(`${migration.path}: SQL migration should reference schema_version table`);
    }

    // Check for version insertion
    if (!migration.content.match(/INSERT.*schema_version.*version/i)) {
      errors.push(
        `${migration.path}: SQL migration should insert version into schema_version table`
      );
    }
  }

  // Check Python migration files
  if (migration.path.endsWith('.py')) {
    if (
      !migration.content.includes('schema_version') &&
      !migration.content.includes('SCHEMA_VERSION')
    ) {
      errors.push(`${migration.path}: Python migration should reference schema_version`);
    }
  }

  return errors;
}

async function main(): Promise<void> {
  console.log('Checking schema migrations...\n');

  const migrations = await findMigrationFiles();

  if (migrations.length === 0) {
    console.log('⚠️  No migration files found in expected directories');
    console.log('   Expected directories:', MIGRATION_DIRS.join(', '));
    return;
  }

  console.log(`Found ${migrations.length} migration file(s):`);
  for (const m of migrations) {
    console.log(`  ${m.path} (v${m.version})`);
  }
  console.log();

  const allErrors: string[] = [];

  // Check each migration file
  for (const migration of migrations) {
    const errors = checkMigrationFile(migration);
    allErrors.push(...errors);
  }

  // Check version continuity
  const versions = migrations.map((m) => m.version);
  const maxVersion = Math.max(...versions);
  const expectedVersions = Array.from({ length: maxVersion }, (_, i) => i + 1);
  const missingVersions = expectedVersions.filter((v) => !versions.includes(v));

  if (missingVersions.length > 0) {
    allErrors.push(`Missing migration versions: ${missingVersions.join(', ')}`);
  }

  // Report results
  if (allErrors.length > 0) {
    console.error('❌ Schema migration check failed:\n');
    for (const error of allErrors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('✅ All schema migrations are properly versioned');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
