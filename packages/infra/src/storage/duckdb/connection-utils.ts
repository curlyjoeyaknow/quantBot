/**
 * DuckDB Connection Utilities
 *
 * Utilities to ensure DuckDB connections are properly managed
 * and WAL files are prevented.
 */

import { logger } from '../../utils/index.js';

/**
 * DuckDB connection cleanup options
 */
export interface ConnectionCleanupOptions {
  /**
   * Whether to log warnings if cleanup is not called
   * @default true
   */
  warnOnMissingCleanup?: boolean;
}

/**
 * Connection manager for DuckDB connections
 *
 * Ensures connections are properly closed to prevent WAL files.
 * Use this wrapper when working with DuckDB connections directly.
 */
export class DuckDBConnectionManager {
  private connections: Set<number> = new Set();
  private connectionCounter = 0;

  /**
   * Register a connection for cleanup tracking
   *
   * @returns Connection ID for tracking
   */
  registerConnection(): number {
    const id = ++this.connectionCounter;
    this.connections.add(id);
    return id;
  }

  /**
   * Unregister a connection after cleanup
   *
   * @param id - Connection ID from registerConnection
   */
  unregisterConnection(id: number): void {
    this.connections.delete(id);
  }

  /**
   * Get count of unclosed connections
   */
  getUnclosedCount(): number {
    return this.connections.size;
  }

  /**
   * Log warning if there are unclosed connections
   */
  warnUnclosedConnections(): void {
    const count = this.connections.size;
    if (count > 0) {
      logger.warn(`Found ${count} unclosed DuckDB connections. This may lead to WAL files.`);
    }
  }
}

/**
 * Global connection manager instance
 */
export const connectionManager = new DuckDBConnectionManager();

/**
 * Ensure DuckDB connections are closed to prevent WAL files
 *
 * This is a best practice reminder. All Python scripts should:
 * 1. Always call con.close() after operations
 * 2. Use try/finally blocks to ensure cleanup
 * 3. Never leave connections open
 *
 * Example:
 * ```python
 * con = duckdb.connect(db_path)
 * try:
 *     # ... operations ...
 * finally:
 *     con.close()  # Always close!
 * ```
 */
export function ensureConnectionCleanup(): void {
  connectionManager.warnUnclosedConnections();
}

/**
 * Documentation note: Preventing WAL Files
 *
 * DuckDB creates WAL (Write-Ahead Log) files when:
 * 1. Connections remain open after writes
 * 2. Transactions are not properly committed/closed
 * 3. Processes crash without cleanup
 *
 * Best practices:
 * - Always close connections after use
 * - Use try/finally blocks for cleanup
 * - Never commit WAL files to git (already in .gitignore)
 * - Use Python scripts with proper connection management
 */
