/**
 * PostgreSQL Database Manager for Web Dashboard
 * Replaces the old SQLite db-manager
 */
import { Pool, PoolClient } from 'pg';
declare class PostgresManager {
    private static instance;
    private pool;
    private constructor();
    static getInstance(): PostgresManager;
    getPool(): Pool;
    getClient(): Promise<PoolClient>;
    query(text: string, params?: any[]): Promise<import("pg").QueryResult<any>>;
    healthCheck(): Promise<boolean>;
    close(): Promise<void>;
}
export declare const postgresManager: PostgresManager;
export {};
//# sourceMappingURL=postgres-manager.d.ts.map