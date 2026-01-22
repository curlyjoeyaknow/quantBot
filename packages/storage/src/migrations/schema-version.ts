/**
 * Schema Version Management
 *
 * Tracks and enforces schema version compatibility across DuckDB and ClickHouse.
 *
 * Addresses: Risk #1 from ARCHITECTURE_REVIEW_2026-01-21.md
 *           "Schema migration strategy is implicit"
 *
 * Usage:
 *   const version = await getCurrentSchemaVersion(db, 'duckdb');
 *   await ensureSchemaVersion(db, 'duckdb', 5); // Fail if not at version 5
 */

import { logger } from '@quantbot/utils';

// Simple connection type for now
type DuckDbConnection = {
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<void>;
};

export interface SchemaMigration {
  version: number;
  name: string;
  description: string | null;
  database_type: 'duckdb' | 'clickhouse';
  applied_at: Date;
  applied_by: string;
  checksum: string | null;
  execution_time_ms: number | null;
  status: 'applied' | 'rolled_back' | 'failed';
  rollback_sql: string | null;
}

export interface SchemaVersion {
  database_type: 'duckdb' | 'clickhouse';
  current_version: number;
  total_migrations: number;
}

/**
 * Get current schema version for a database type
 */
export async function getCurrentSchemaVersion(
  db: DuckDbConnection,
  databaseType: 'duckdb' | 'clickhouse'
): Promise<number> {
  try {
    const result = await db.get<{ current_version: number | null }>(
      `SELECT current_version 
       FROM current_schema_version 
       WHERE database_type = ?`,
      [databaseType]
    );

    return result?.current_version ?? 0;
  } catch (error) {
    // If schema_migrations table doesn't exist, we're at version 0
    logger.warn('Schema migrations table not found, assuming version 0', {
      databaseType,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}

/**
 * Ensure schema is at expected version
 * Throws if version mismatch
 */
export async function ensureSchemaVersion(
  db: DuckDbConnection,
  databaseType: 'duckdb' | 'clickhouse',
  expectedVersion: number
): Promise<void> {
  const currentVersion = await getCurrentSchemaVersion(db, databaseType);

  if (currentVersion !== expectedVersion) {
    throw new Error(
      `Schema version mismatch for ${databaseType}: ` +
        `expected ${expectedVersion}, found ${currentVersion}. ` +
        `Run migrations: pnpm migrate:up`
    );
  }

  logger.debug('Schema version verified', {
    databaseType,
    version: currentVersion,
  });
}

/**
 * Get all migration history for a database type
 */
export async function getMigrationHistory(
  db: DuckDbConnection,
  databaseType: 'duckdb' | 'clickhouse'
): Promise<SchemaMigration[]> {
  const rows = await db.all<SchemaMigration>(
    `SELECT * FROM schema_migrations 
     WHERE database_type = ? 
     ORDER BY version ASC`,
    [databaseType]
  );

  return rows;
}

/**
 * Check if a specific migration has been applied
 */
export async function isMigrationApplied(
  db: DuckDbConnection,
  version: number,
  databaseType: 'duckdb' | 'clickhouse'
): Promise<boolean> {
  const result = await db.get<{ count: number }>(
    `SELECT COUNT(*) as count 
     FROM schema_migrations 
     WHERE version = ? 
       AND database_type = ? 
       AND status = 'applied'`,
    [version, databaseType]
  );

  return (result?.count ?? 0) > 0;
}

/**
 * Record a migration as applied
 */
export async function recordMigration(
  db: DuckDbConnection,
  migration: {
    version: number;
    name: string;
    description: string;
    database_type: 'duckdb' | 'clickhouse';
    checksum: string;
    execution_time_ms: number;
    rollback_sql?: string;
  }
): Promise<void> {
  await db.run(
    `INSERT INTO schema_migrations 
     (version, name, description, database_type, checksum, execution_time_ms, rollback_sql, status, applied_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', 'system')`,
    [
      migration.version,
      migration.name,
      migration.description,
      migration.database_type,
      migration.checksum,
      migration.execution_time_ms,
      migration.rollback_sql ?? null,
    ]
  );

  logger.info('Migration recorded', {
    version: migration.version,
    name: migration.name,
    database_type: migration.database_type,
  });
}

/**
 * Mark a migration as rolled back
 */
export async function recordRollback(
  db: DuckDbConnection,
  version: number,
  databaseType: 'duckdb' | 'clickhouse'
): Promise<void> {
  await db.run(
    `UPDATE schema_migrations 
     SET status = 'rolled_back' 
     WHERE version = ? AND database_type = ?`,
    [version, databaseType]
  );

  logger.info('Migration rolled back', {
    version,
    database_type: databaseType,
  });
}

/**
 * Initialize schema_migrations table if it doesn't exist
 */
export async function initializeSchemaTracking(db: DuckDbConnection): Promise<void> {
  try {
    // Try to query the table
    await db.get('SELECT 1 FROM schema_migrations LIMIT 1');
    logger.debug('Schema migrations table already exists');
  } catch (error) {
    // Table doesn't exist, create it
    logger.info('Creating schema_migrations table');

    await db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name VARCHAR NOT NULL,
        description TEXT,
        database_type VARCHAR NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        applied_by VARCHAR DEFAULT 'system',
        checksum VARCHAR,
        execution_time_ms INTEGER,
        status VARCHAR NOT NULL DEFAULT 'applied',
        rollback_sql TEXT
      )
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_version 
        ON schema_migrations(version)
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_database_type 
        ON schema_migrations(database_type)
    `);

    // Insert initial record
    await db.run(`
      INSERT INTO schema_migrations (version, name, description, database_type, status)
      VALUES (0, 'initial', 'Schema migrations tracking table', 'duckdb', 'applied')
    `);

    logger.info('Schema migrations table created');
  }
}
