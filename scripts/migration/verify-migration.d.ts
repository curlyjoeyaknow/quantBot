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
declare class MigrationVerifier {
    private pgPool;
    private clickhouse;
    private results;
    constructor();
    private getClickHouseClient;
    private openSqliteDb;
    private closeSqliteDb;
    private getSqliteCount;
    private getPostgresCount;
    private getClickHouseCount;
    verifyCallerAlerts(): Promise<void>;
    private verifyCallerAlertsDb;
    verifyQuantbot(): Promise<void>;
    verifyStrategyResults(): Promise<void>;
    verifyDashboardMetrics(): Promise<void>;
    verifyUnifiedCalls(): Promise<void>;
    printResults(): void;
    verify(): Promise<boolean>;
    close(): Promise<void>;
}
export { MigrationVerifier };
//# sourceMappingURL=verify-migration.d.ts.map