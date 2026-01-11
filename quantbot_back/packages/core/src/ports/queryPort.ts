/**
 * Query Port
 *
 * Port interface for analytical queries (SQL, ClickHouse, etc.).
 * Used for complex queries that don't fit the key-value StatePort model.
 */

export type QueryRequest = {
  query: string;
  params?: unknown[]; // Query parameters for parameterized queries
  format?: 'JSONEachRow' | 'JSON' | 'CSV'; // Output format (ClickHouse-specific)
};

export type QueryResult = {
  rows: unknown[];
  rowCount: number;
  error?: string;
};

export interface QueryPort {
  /**
   * Execute an analytical query
   */
  query(request: QueryRequest): Promise<QueryResult>;

  /**
   * Check if the query port is available
   */
  isAvailable(): Promise<boolean>;
}
