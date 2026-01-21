/**
 * DuckDB Data Helper Service
 *
 * Provides a safe, documented interface for querying data/alerts.duckdb.
 * Wraps Python data helper via PythonEngine to prevent agents from querying wrong tables/views.
 *
 * This service follows the codebase architecture:
 * - TypeScript for orchestration
 * - Python for heavy data lifting
 * - Schema validation
 * - Helpful error messages
 */

import { PythonEngine, getPythonEngine, findWorkspaceRoot, logger } from '@quantbot/infra/utils';
import { z } from 'zod';
import { join } from 'path';

/**
 * Alert filters for querying alerts
 */
export interface AlertFilters {
  caller_name?: string;
  caller_id?: string;
  mint?: string;
  chain?: 'solana' | 'evm';
  from_ts_ms?: number;
  to_ts_ms?: number;
  alert_kind?: 'human' | 'bot_only';
  has_caller_id?: boolean;
  limit?: number;
}

/**
 * Caller filters for querying callers
 */
export interface CallerFilters {
  caller_id?: string;
  caller_raw_name?: string;
  caller_name_norm?: string;
  caller_base?: string;
}

/**
 * Alert record from canon.alerts_std
 */
export interface AlertRecord {
  alert_id: string;
  alert_chat_id: number;
  alert_message_id: number;
  alert_ts_ms: number;
  alert_kind: string | null;
  mint: string | null;
  chain: string | null;
  mint_source: string | null;
  caller_raw_name: string | null;
  caller_id: string | null;
  caller_name_norm: string | null;
  caller_base: string | null;
  alert_text: string | null;
  run_id: string | null;
  ingested_at: string | null;
}

/**
 * Caller record from canon.callers_d
 */
export interface CallerRecord {
  caller_id: string;
  caller_raw_name: string;
  caller_name_norm: string | null;
  caller_base: string | null;
}

/**
 * View schema information
 */
export interface ViewSchema {
  view_name: string;
  schema: string;
  description: string;
  columns: Array<{ name: string; type: string }>;
  primary: boolean;
}

/**
 * Database information
 */
export interface DatabaseInfo {
  schemas: string[];
  canon_views: string[];
  view_count: number;
  alerts_count: number;
}

/**
 * Query alerts result schema
 */
const QueryAlertsResultSchema = z.object({
  success: z.boolean(),
  alerts: z.array(z.record(z.string(), z.unknown())).optional(),
  error: z.string().optional(),
});

/**
 * Query callers result schema
 */
const QueryCallersResultSchema = z.object({
  success: z.boolean(),
  callers: z.array(z.record(z.string(), z.unknown())).optional(),
  error: z.string().optional(),
});

/**
 * Validate view result schema
 */
const ValidateViewResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable().optional(),
});

/**
 * Get view schema result schema
 */
const GetViewSchemaResultSchema = z.object({
  success: z.boolean(),
  schema: z
    .object({
      view_name: z.string(),
      schema: z.string(),
      description: z.string(),
      columns: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
        })
      ),
      primary: z.boolean(),
    })
    .optional(),
  error: z.string().optional(),
});

/**
 * Get database info result schema
 */
const GetDatabaseInfoResultSchema = z.object({
  success: z.boolean(),
  info: z
    .object({
      schemas: z.array(z.string()),
      canon_views: z.array(z.string()),
      view_count: z.number(),
      alerts_count: z.number(),
    })
    .optional(),
  error: z.string().optional(),
});

/**
 * DuckDB Data Helper Service
 *
 * Provides safe, validated access to DuckDB data with helpful error messages.
 */
export class DuckDBDataHelperService {
  private pythonEngine: PythonEngine;
  private dbPath: string;

  constructor(dbPath: string, pythonEngine?: PythonEngine) {
    this.dbPath = dbPath;
    this.pythonEngine = pythonEngine || getPythonEngine();
  }

  /**
   * Get path to data helper script
   */
  private getScriptPath(): string {
    const workspaceRoot = findWorkspaceRoot();
    return join(workspaceRoot, 'tools/storage/duckdb_data_helper.py');
  }

  /**
   * Query alerts from canon.alerts_std view
   *
   * This is the PRIMARY way to query alerts/calls. All other alert views are deprecated.
   *
   * @param filters - Optional filters for querying alerts
   * @returns Array of alert records
   */
  async queryAlerts(filters: AlertFilters = {}): Promise<AlertRecord[]> {
    try {
      const result = await this.pythonEngine.runScript(
        this.getScriptPath(),
        {
          operation: 'query_alerts',
          'db-path': this.dbPath,
          filters: JSON.stringify(filters),
        },
        QueryAlertsResultSchema
      );

      if (!result.success || !result.alerts) {
        const errorMsg = result.error || 'Unknown error querying alerts';
        throw new Error(`Failed to query alerts: ${errorMsg}`);
      }

      return result.alerts as unknown as AlertRecord[];
    } catch (error) {
      logger.error('Failed to query alerts', error as Error, {
        dbPath: this.dbPath,
        filters,
      });
      throw error;
    }
  }

  /**
   * Query callers from canon.callers_d table
   *
   * @param filters - Optional filters for querying callers
   * @returns Array of caller records
   */
  async queryCallers(filters: CallerFilters = {}): Promise<CallerRecord[]> {
    try {
      const result = await this.pythonEngine.runScript(
        this.getScriptPath(),
        {
          operation: 'query_callers',
          'db-path': this.dbPath,
          filters: JSON.stringify(filters),
        },
        QueryCallersResultSchema
      );

      if (!result.success || !result.callers) {
        const errorMsg = result.error || 'Unknown error querying callers';
        throw new Error(`Failed to query callers: ${errorMsg}`);
      }

      return result.callers as unknown as CallerRecord[];
    } catch (error) {
      logger.error('Failed to query callers', error as Error, {
        dbPath: this.dbPath,
        filters,
      });
      throw error;
    }
  }

  /**
   * Validate that a view name is allowed
   *
   * @param viewName - Name of the view (without schema prefix)
   * @param schema - Schema name (default: 'canon')
   * @returns True if valid, throws error if invalid
   */
  async validateView(viewName: string, schema: string = 'canon'): Promise<boolean> {
    try {
      const result = await this.pythonEngine.runScript(
        this.getScriptPath(),
        {
          operation: 'validate_view',
          'db-path': this.dbPath,
          'view-name': viewName,
          schema,
        },
        ValidateViewResultSchema
      );

      if (!result.success && result.error) {
        throw new Error(result.error);
      }

      return result.success;
    } catch (error) {
      logger.error('Failed to validate view', error as Error, {
        dbPath: this.dbPath,
        viewName,
        schema,
      });
      throw error;
    }
  }

  /**
   * Get schema information for a view
   *
   * @param viewName - Name of the view (without schema prefix)
   * @param schema - Schema name (default: 'canon')
   * @returns View schema information
   */
  async getViewSchema(viewName: string, schema: string = 'canon'): Promise<ViewSchema> {
    try {
      const result = await this.pythonEngine.runScript(
        this.getScriptPath(),
        {
          operation: 'get_view_schema',
          'db-path': this.dbPath,
          'view-name': viewName,
          schema,
        },
        GetViewSchemaResultSchema
      );

      if (!result.success || !result.schema) {
        const errorMsg = result.error || 'Unknown error getting view schema';
        throw new Error(`Failed to get view schema: ${errorMsg}`);
      }

      return result.schema;
    } catch (error) {
      logger.error('Failed to get view schema', error as Error, {
        dbPath: this.dbPath,
        viewName,
        schema,
      });
      throw error;
    }
  }

  /**
   * Get database information
   *
   * @returns Database information including schemas, views, and counts
   */
  async getDatabaseInfo(): Promise<DatabaseInfo> {
    try {
      const result = await this.pythonEngine.runScript(
        this.getScriptPath(),
        {
          operation: 'get_database_info',
          'db-path': this.dbPath,
        },
        GetDatabaseInfoResultSchema
      );

      if (!result.success || !result.info) {
        const errorMsg = result.error || 'Unknown error getting database info';
        throw new Error(`Failed to get database info: ${errorMsg}`);
      }

      return result.info;
    } catch (error) {
      logger.error('Failed to get database info', error as Error, {
        dbPath: this.dbPath,
      });
      throw error;
    }
  }

  /**
   * Get database path
   */
  getDbPath(): string {
    return this.dbPath;
  }
}

/**
 * Default database path
 */
export const DEFAULT_DB_PATH = 'data/alerts.duckdb';

/**
 * Get or create DuckDB Data Helper Service
 */
const helperServices: Map<string, DuckDBDataHelperService> = new Map();

export function getDuckDBDataHelperService(
  dbPath: string = DEFAULT_DB_PATH
): DuckDBDataHelperService {
  if (!helperServices.has(dbPath)) {
    helperServices.set(dbPath, new DuckDBDataHelperService(dbPath));
  }
  return helperServices.get(dbPath)!;
}
