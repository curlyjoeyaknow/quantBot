#!/usr/bin/env tsx
/**
 * Verification script for SQLite to PostgreSQL/ClickHouse migration
 * 
 * Compares row counts and key metrics between SQLite and PostgreSQL/ClickHouse
 * to ensure data was migrated correctly.
 * 
 * Usage:
 *   tsx scripts/migration/verify-migration.ts
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import * as path from 'path';
import { Pool } from 'pg';
import { getClickHouseClient } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { config } from 'dotenv';

config();

interface VerificationResult {
  source: string;
  table: string;
  sqliteCount: number;
  targetCount: number;
  match: boolean;
  difference: number;
}

class MigrationVerifier {
  private pgPool: Pool;
  private results: VerificationResult[] = [];

  constructor() {
    this.pgPool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      user: process.env.POSTGRES_USER || 'quantbot',
      password: process.env.POSTGRES_PASSWORD || '',
      database: process.env.POSTGRES_DATABASE || 'quantbot',
    });
  }

  private async openSqliteDb(dbPath: string): Promise<Database | null> {
    const fs = await import('fs');
    if (!fs.existsSync(dbPath)) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const db = new Database(dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  private async closeSqliteDb(db: Database): Promise<void> {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async getSqliteCount(db: Database, query: string): Promise<number> {
    const get = promisify(db.get.bind(db));
    const result = await get(query) as any;
    return result?.count || 0;
  }

  private async getPostgresCount(query: string): Promise<number> {
    const result = await this.pgPool.query(query);
    return parseInt(result.rows[0]?.count || '0');
  }

  private async getClickHouseCount(query: string): Promise<number> {
    const ch = getClickHouseClient();
    const result = await ch.query({
      query,
      format: 'JSONEachRow',
    });
    const rows = await result.json() as any[];
    return rows[0]?.count || 0;
  }

  async verifyCallerAlerts(): Promise<void> {
    logger.info('Verifying caller_alerts migration...');

    const dbPath = path.join(process.cwd(), 'data', 'caller_alerts.db');
    const db = await this.openSqliteDb(dbPath);
    if (!db) {
      const dbPath2 = path.join(process.cwd(), 'data', 'databases', 'caller_alerts.db');
      const db2 = await this.openSqliteDb(dbPath2);
      if (!db2) {
        logger.warn('No caller_alerts.db found, skipping verification');
        return;
      }
      return this.verifyCallerAlertsDb(db2);
    }

    await this.verifyCallerAlertsDb(db);
    await this.closeSqliteDb(db);
  }

  private async verifyCallerAlertsDb(db: Database): Promise<void> {
    // Verify unique callers
    const sqliteCallers = await this.getSqliteCount(
      db,
      'SELECT COUNT(DISTINCT caller_name) as count FROM caller_alerts'
    );
    const pgCallers = await this.getPostgresCount(
      "SELECT COUNT(*) as count FROM callers WHERE source = 'legacy'"
    );

    this.results.push({
      source: 'caller_alerts',
      table: 'callers',
      sqliteCount: sqliteCallers,
      targetCount: pgCallers,
      match: sqliteCallers <= pgCallers,
      difference: pgCallers - sqliteCallers,
    });

    // Verify unique tokens
    const sqliteTokens = await this.getSqliteCount(
      db,
      'SELECT COUNT(DISTINCT token_address) as count FROM caller_alerts WHERE token_address IS NOT NULL'
    );
    const pgTokens = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM tokens'
    );

    this.results.push({
      source: 'caller_alerts',
      table: 'tokens',
      sqliteCount: sqliteTokens,
      targetCount: pgTokens,
      match: sqliteTokens <= pgTokens,
      difference: pgTokens - sqliteTokens,
    });

    // Verify alerts
    const sqliteAlerts = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM caller_alerts'
    );
    const pgAlerts = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM alerts'
    );

    this.results.push({
      source: 'caller_alerts',
      table: 'alerts',
      sqliteCount: sqliteAlerts,
      targetCount: pgAlerts,
      match: sqliteAlerts <= pgAlerts,
      difference: pgAlerts - sqliteAlerts,
    });
  }

  async verifyQuantbot(): Promise<void> {
    logger.info('Verifying quantbot.db migration...');

    const dbPath = path.join(process.cwd(), 'data', 'quantbot.db');
    const db = await this.openSqliteDb(dbPath);
    if (!db) {
      logger.warn('No quantbot.db found, skipping verification');
      return;
    }

    // Verify tokens
    const sqliteTokens = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM tokens'
    );
    const pgTokens = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM tokens'
    );

    this.results.push({
      source: 'quantbot',
      table: 'tokens',
      sqliteCount: sqliteTokens,
      targetCount: pgTokens,
      match: sqliteTokens <= pgTokens,
      difference: pgTokens - sqliteTokens,
    });

    // Verify strategies
    const sqliteStrategies = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM strategies'
    );
    const pgStrategies = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM strategies'
    );

    this.results.push({
      source: 'quantbot',
      table: 'strategies',
      sqliteCount: sqliteStrategies,
      targetCount: pgStrategies,
      match: sqliteStrategies <= pgStrategies,
      difference: pgStrategies - sqliteStrategies,
    });

    // Verify simulation runs
    const sqliteRuns = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM simulation_runs'
    );
    const pgRuns = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM simulation_runs'
    );

    this.results.push({
      source: 'quantbot',
      table: 'simulation_runs',
      sqliteCount: sqliteRuns,
      targetCount: pgRuns,
      match: sqliteRuns <= pgRuns,
      difference: pgRuns - sqliteRuns,
    });

    // Verify simulation events (ClickHouse)
    if (process.env.USE_CLICKHOUSE === 'true') {
      const sqliteEvents = await this.getSqliteCount(
        db,
        'SELECT COUNT(*) as count FROM simulation_events'
      );
      const chEvents = await this.getClickHouseCount(
        'SELECT COUNT(*) as count FROM quantbot.simulation_events'
      );

      this.results.push({
        source: 'quantbot',
        table: 'simulation_events (ClickHouse)',
        sqliteCount: sqliteEvents,
        targetCount: chEvents,
        match: sqliteEvents <= chEvents,
        difference: chEvents - sqliteEvents,
      });
    }

    await this.closeSqliteDb(db);
  }

  async verifyStrategyResults(): Promise<void> {
    logger.info('Verifying strategy_results.db migration...');

    const dbPath = path.join(process.cwd(), 'data', 'strategy_results.db');
    let db = await this.openSqliteDb(dbPath);
    if (!db) {
      const dbPath2 = path.join(process.cwd(), 'data', 'databases', 'strategy_results.db');
      db = await this.openSqliteDb(dbPath2);
      if (!db) {
        logger.warn('No strategy_results.db found, skipping verification');
        return;
      }
    }

    const sqliteResults = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM strategy_results'
    );

    // These would be integrated into simulation_results_summary
    const pgResults = await this.getPostgresCount(
      "SELECT COUNT(*) as count FROM simulation_results_summary WHERE metadata_json->>'strategy_result' IS NOT NULL"
    );

    this.results.push({
      source: 'strategy_results',
      table: 'simulation_results_summary',
      sqliteCount: sqliteResults,
      targetCount: pgResults,
      match: sqliteResults <= pgResults,
      difference: pgResults - sqliteResults,
    });

    await this.closeSqliteDb(db);
  }

  async verifyDashboardMetrics(): Promise<void> {
    logger.info('Verifying dashboard_metrics.db migration...');

    const dbPath = path.join(process.cwd(), 'data', 'dashboard_metrics.db');
    let db = await this.openSqliteDb(dbPath);
    if (!db) {
      const dbPath2 = path.join(process.cwd(), 'data', 'databases', 'dashboard_metrics.db');
      db = await this.openSqliteDb(dbPath2);
      if (!db) {
        logger.warn('No dashboard_metrics.db found, skipping verification');
        return;
      }
    }

    const sqliteMetrics = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM dashboard_metrics'
    );
    const pgMetrics = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM dashboard_metrics'
    );

    this.results.push({
      source: 'dashboard_metrics',
      table: 'dashboard_metrics',
      sqliteCount: sqliteMetrics,
      targetCount: pgMetrics,
      match: sqliteMetrics === pgMetrics,
      difference: pgMetrics - sqliteMetrics,
    });

    await this.closeSqliteDb(db);
  }

  async verifyUnifiedCalls(): Promise<void> {
    logger.info('Verifying unified_calls.db migration...');

    const dbPath = path.join(process.cwd(), 'data', 'unified_calls.db');
    const db = await this.openSqliteDb(dbPath);
    if (!db) {
      logger.warn('No unified_calls.db found, skipping verification');
      return;
    }

    const sqliteCalls = await this.getSqliteCount(
      db,
      'SELECT COUNT(*) as count FROM unified_calls'
    );
    const pgCalls = await this.getPostgresCount(
      'SELECT COUNT(*) as count FROM calls'
    );

    this.results.push({
      source: 'unified_calls',
      table: 'calls',
      sqliteCount: sqliteCalls,
      targetCount: pgCalls,
      match: sqliteCalls <= pgCalls,
      difference: pgCalls - sqliteCalls,
    });

    await this.closeSqliteDb(db);
  }

  printResults(): void {
    logger.info('='.repeat(100));
    logger.info('Migration Verification Results');
    logger.info('='.repeat(100));

    console.log('');
    console.log('┌─────────────────────┬────────────────────────────────┬────────────┬────────────┬────────────┬──────────┐');
    console.log('│ Source              │ Table                          │ SQLite     │ Target     │ Diff       │ Status   │');
    console.log('├─────────────────────┼────────────────────────────────┼────────────┼────────────┼────────────┼──────────┤');

    let totalMatch = 0;
    let totalMismatch = 0;

    for (const result of this.results) {
      const status = result.match ? '✓ PASS' : '✗ FAIL';
      const statusColor = result.match ? '\x1b[32m' : '\x1b[31m';
      const resetColor = '\x1b[0m';

      const source = result.source.padEnd(19);
      const table = result.table.padEnd(30);
      const sqliteCount = result.sqliteCount.toString().padStart(10);
      const targetCount = result.targetCount.toString().padStart(10);
      const diff = result.difference.toString().padStart(10);

      console.log(
        `│ ${source} │ ${table} │ ${sqliteCount} │ ${targetCount} │ ${diff} │ ${statusColor}${status}${resetColor}    │`
      );

      if (result.match) {
        totalMatch++;
      } else {
        totalMismatch++;
      }
    }

    console.log('└─────────────────────┴────────────────────────────────┴────────────┴────────────┴────────────┴──────────┘');
    console.log('');

    logger.info('='.repeat(100));
    logger.info(`Summary: ${totalMatch} passed, ${totalMismatch} failed`);
    logger.info('='.repeat(100));

    if (totalMismatch > 0) {
      logger.warn('Some verifications failed. Review the results above.');
      logger.warn('Note: Target counts >= SQLite counts is acceptable (due to merging from multiple sources)');
    } else {
      logger.info('All verifications passed! ✓');
    }
  }

  async verify(): Promise<boolean> {
    try {
      await this.verifyCallerAlerts();
      await this.verifyQuantbot();
      await this.verifyStrategyResults();
      await this.verifyDashboardMetrics();
      await this.verifyUnifiedCalls();

      this.printResults();

      const allMatch = this.results.every(r => r.match);
      return allMatch;
    } catch (error) {
      logger.error('Verification failed', error as Error);
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pgPool.end();
  }
}

async function main() {
  const verifier = new MigrationVerifier();

  try {
    const success = await verifier.verify();
    process.exit(success ? 0 : 1);
  } catch (error) {
    logger.error('Verification failed', error as Error);
    process.exit(1);
  } finally {
    await verifier.close();
  }
}

if (require.main === module) {
  main();
}

export { MigrationVerifier };

