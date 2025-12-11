import { Pool, PoolClient, QueryResult } from 'pg';
export interface PostgresConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    maxConnections: number;
}
export declare function getPostgresPool(): Pool;
export declare function getPostgresClient(): Promise<PoolClient>;
export declare function queryPostgres<T = unknown>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
export declare function withPostgresTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T>;
export declare function closePostgresPool(): Promise<void>;
//# sourceMappingURL=postgres-client.d.ts.map