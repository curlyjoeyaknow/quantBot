#!/usr/bin/env tsx
/**
 * SQLite to PostgreSQL and ClickHouse Migration Script
 *
 * This script migrates data from existing SQLite database files to:
 * - PostgreSQL: OLTP data (tokens, strategies, simulation runs, alerts, callers)
 * - ClickHouse: Time-series data (simulation events, OHLCV data)
 *
 * Usage:
 *   tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts [--dry-run] [--db <database-name>]
 *
 * Options:
 *   --dry-run: Show what would be migrated without actually migrating
 *   --db <name>: Migrate only a specific database (e.g., caller_alerts, quantbot, strategy_results)
 */
declare class DatabaseMigrator {
    private pgPool;
    private clickhouse;
    private stats;
    private dryRun;
    constructor(dryRun?: boolean);
    private getClickHouseClient;
    /**
     * Open SQLite database connection
     */
    private openSqliteDb;
    /**
     * Close SQLite database connection
     */
    private closeSqliteDb;
    /**
     * Migrate caller_alerts.db to PostgreSQL
     */
    private migrateCallerAlerts;
    /**
     * Migrate quantbot.db (main database) to PostgreSQL
     */
    private migrateQuantbot;
    /**
     * Migrate strategy_results.db to PostgreSQL
     */
    private migrateStrategyResults;
    /**
     * Migrate dashboard_metrics.db to PostgreSQL
     */
    private migrateDashboardMetrics;
    /**
     * Migrate simulation_events to ClickHouse
     */
    private migrateSimulationEvents;
    /**
     * Migrate unified_calls.db to PostgreSQL
     */
    private migrateUnifiedCalls;
    /**
     * Run all migrations
     */
    migrate(specificDb?: string): Promise<void>;
    /**
     * Check if database file exists
     */
    private dbExists;
    /**
     * Print migration summary
     */
    private printSummary;
    /**
     * Close database connections
     */
    close(): Promise<void>;
}
export { DatabaseMigrator };
//# sourceMappingURL=migrate-sqlite-to-postgres-clickhouse.d.ts.map