/**
 * StatePort adapter backed by DuckDB
 *
 * Persistent state storage for idempotency checks and checkpoints.
 * Uses DuckDB for local, auditable, replay-friendly state management.
 *
 * Features:
 * - Persistent across process restarts
 * - TTL support (expires_at column)
 * - Namespace support for key scoping
 * - JSON value storage
 */

import type {
  StatePort,
  StateGetRequest,
  StateSetRequest,
  StateDeleteRequest,
  StateGetResult,
  StateQueryRequest,
  StateQueryResult,
  StateTransaction,
  StateTransactionResult,
} from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import { logger } from '@quantbot/utils';
import { z } from 'zod';

const StateGetResultSchema = z.object({
  success: z.boolean(),
  found: z.boolean(),
  value: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

const StateSetResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable().optional(),
});

/**
 * Create a StatePort adapter backed by DuckDB
 *
 * @param duckdbPath - Path to DuckDB database file
 * @param pythonEngine - Optional PythonEngine instance (creates new one if not provided)
 */
export function createStateDuckdbAdapter(
  duckdbPath: string,
  pythonEngine?: PythonEngine
): StatePort {
  const engine = pythonEngine || new PythonEngine();

  // Initialize state table on first use (lazy initialization)
  let initialized = false;
  const initPromise = (async () => {
    if (initialized) return;
    try {
      await engine.runDuckDBStorage({
        duckdbPath,
        operation: 'init_state_table',
        data: {},
      });
      initialized = true;
    } catch (error) {
      // Table might already exist, which is fine
      logger.debug('State table initialization', {
        error: error instanceof Error ? error.message : String(error),
      });
      initialized = true; // Mark as initialized even on error (table likely exists)
    }
  })();

  return {
    async get<T = unknown>(request: StateGetRequest): Promise<StateGetResult<T>> {
      try {
        await initPromise;

        const result = await engine.runDuckDBStorage({
          duckdbPath,
          operation: 'get_state',
          data: {
            key: request.key,
            namespace: request.namespace || 'default',
          },
        });

        const parsed = StateGetResultSchema.parse(result);
        
        if (!parsed.success) {
          logger.error('StatePort.get operation failed', {
            key: request.key,
            error: parsed.error,
          });
          return { found: false };
        }

        if (!parsed.found || !parsed.value) {
          return { found: false };
        }

        // Parse JSON value
        try {
          const parsedValue = JSON.parse(parsed.value) as T;
          return { found: true, value: parsedValue };
        } catch {
          // If not JSON, return as string
          return { found: true, value: parsed.value as T };
        }
      } catch (error) {
        logger.error('StatePort.get failed', error as Error, { key: request.key });
        return { found: false };
      }
    },

    async set(request: StateSetRequest): Promise<{ success: boolean; error?: string }> {
      try {
        await initPromise;

        const value = typeof request.value === 'string' 
          ? request.value 
          : JSON.stringify(request.value);

        const result = await engine.runDuckDBStorage({
          duckdbPath,
          operation: 'set_state',
          data: {
            key: request.key,
            namespace: request.namespace || 'default',
            value,
            ttl_seconds: request.ttlSeconds,
          },
        });

        return StateSetResultSchema.parse(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('StatePort.set failed', error as Error, { key: request.key });
        return { success: false, error: errorMessage };
      }
    },

    async delete(request: StateDeleteRequest): Promise<{ success: boolean; error?: string }> {
      try {
        await initPromise;

        const result = await engine.runDuckDBStorage({
          duckdbPath,
          operation: 'delete_state',
          data: {
            key: request.key,
            namespace: request.namespace || 'default',
          },
        });

        return StateSetResultSchema.parse(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('StatePort.delete failed', error as Error, { key: request.key });
        return { success: false, error: errorMessage };
      }
    },

    async query(_request: StateQueryRequest): Promise<StateQueryResult> {
      // Not implemented for DuckDB adapter (would require SQL query support)
      logger.warn('StatePort.query not implemented in DuckDB adapter');
      return { rows: [], rowCount: 0 };
    },

    async transaction(_request: StateTransaction): Promise<StateTransactionResult> {
      // Not implemented for DuckDB adapter (would require transaction support)
      logger.warn('StatePort.transaction not implemented in DuckDB adapter');
      return {
        success: false,
        results: [],
        error: 'Transaction not implemented in DuckDB adapter',
      };
    },

    async isAvailable(): Promise<boolean> {
      try {
        await initPromise;
        return true;
      } catch {
        return false;
      }
    },
  };
}

