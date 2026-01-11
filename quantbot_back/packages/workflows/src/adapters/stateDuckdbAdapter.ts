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
import { getPythonEngine } from '@quantbot/utils';
import { z } from 'zod';

/**
 * StatePort adapter wrapping DuckDB storage
 *
 * This adapter implements the StatePort interface using DuckDB as the backend.
 * It uses a dedicated state table for key-value storage with namespace and TTL support.
 *
 * Schema:
 * - key: TEXT (primary key with namespace)
 * - namespace: TEXT (default: 'default')
 * - value: TEXT (JSON-serialized)
 * - created_at: TIMESTAMP
 * - expires_at: TIMESTAMP (NULL for no expiration)
 */
export function createStateDuckdbAdapter(duckdbPath: string): StatePort {
  const pythonEngine = getPythonEngine();

  // Schema for DuckDB operations
  const StateOperationResultSchema = z.object({
    success: z.boolean(),
    error: z.string().nullable().optional(),
    value: z.unknown().optional(),
    found: z.boolean().optional(),
    rows: z.array(z.unknown()).optional(),
    rowCount: z.number().optional(),
  });

  return {
    async get<T = unknown>(request: StateGetRequest): Promise<StateGetResult<T>> {
      try {
        const result = await pythonEngine.runDuckDBStorage({
          duckdbPath,
          operation: 'get_state',
          data: {
            key: request.key,
            namespace: request.namespace ?? 'default',
          },
        });

        const validated = StateOperationResultSchema.parse(result);

        if (!validated.found) {
          return { found: false };
        }

        // Parse JSON string back to object (Python returns string, we need to deserialize)
        let parsedValue: T;
        if (typeof validated.value === 'string') {
          try {
            parsedValue = JSON.parse(validated.value) as T;
          } catch {
            // If parsing fails, return as-is (might be a plain string value)
            parsedValue = validated.value as T;
          }
        } else {
          parsedValue = validated.value as T;
        }

        return {
          found: true,
          value: parsedValue,
        };
      } catch {
        // Return not found on error (graceful degradation)
        return { found: false };
      }
    },

    async set(request: StateSetRequest): Promise<{ success: boolean; error?: string }> {
      try {
        // Serialize value to JSON string (Python expects string, not object)
        const valueString =
          typeof request.value === 'string' ? request.value : JSON.stringify(request.value);

        const result = await pythonEngine.runDuckDBStorage({
          duckdbPath,
          operation: 'set_state',
          data: {
            key: request.key,
            value: valueString,
            namespace: request.namespace ?? 'default',
            ttl_seconds: request.ttlSeconds,
          },
        });

        const validated = StateOperationResultSchema.parse(result);

        return {
          success: validated.success,
          error: validated.error ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async delete(request: StateDeleteRequest): Promise<{ success: boolean; error?: string }> {
      try {
        const result = await pythonEngine.runDuckDBStorage({
          duckdbPath,
          operation: 'delete_state',
          data: {
            key: request.key,
            namespace: request.namespace ?? 'default',
          },
        });

        const validated = StateOperationResultSchema.parse(result);

        return {
          success: validated.success,
          error: validated.error ?? undefined,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async query(_request: StateQueryRequest): Promise<StateQueryResult> {
      try {
        // Query operations not yet supported in DuckDB storage - return empty result
        // TODO: Implement query_state operation in Python script
        return {
          rows: [],
          rowCount: 0,
        };
      } catch {
        return {
          rows: [],
          rowCount: 0,
        };
      }
    },

    async transaction(request: StateTransaction): Promise<StateTransactionResult> {
      try {
        // Execute operations sequentially (DuckDB doesn't support true transactions via Python easily)
        // This is a simplified implementation - real transactions would need BEGIN/COMMIT
        const results: Array<StateGetResult | { success: boolean } | StateQueryResult> = [];

        for (const op of request.operations) {
          if (op.type === 'get') {
            const result = await this.get(op.request);
            results.push(result);
          } else if (op.type === 'set') {
            const result = await this.set(op.request);
            results.push(result);
          } else if (op.type === 'delete') {
            const result = await this.delete(op.request);
            results.push(result);
          } else if (op.type === 'query') {
            const result = await this.query(op.request);
            results.push(result);
          }
        }

        return {
          success: true,
          results,
        };
      } catch (error) {
        return {
          success: false,
          results: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async isAvailable(): Promise<boolean> {
      try {
        // Try to initialize state table (idempotent operation)
        const result = await pythonEngine.runDuckDBStorage({
          duckdbPath,
          operation: 'init_state_table',
          data: {},
        });

        const validated = StateOperationResultSchema.parse(result);
        return validated.success;
      } catch {
        return false;
      }
    },
  };
}
