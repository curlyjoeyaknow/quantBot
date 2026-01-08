/**
 * Query Calls from DuckDB Workflow
 * ==================================
 *
 * Queries calls from DuckDB user_calls_d table with filtering options.
 * Returns CallRecord[] format for use in workflows.
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 *
 * TODO: Future Port Migration
 * ===========================
 * This workflow currently uses `ctx.services.duckdbStorage.queryCalls()` which is not a port.
 * Future work: Move query logic to `packages/storage/src/duckdb/repositories/CallsRepository.ts`
 * as a repository interface, or add a `CallsPort` to `@quantbot/core/src/ports/` if calls
 * querying becomes a first-class port.
 */

import { z } from 'zod';

import { DateTime } from 'luxon';

import { ValidationError, ConfigurationError } from '@quantbot/utils';
import type { WorkflowContext, CallRecord } from '../types.js';

/**
 * Query Calls Spec
 */
export const QueryCallsDuckdbSpecSchema = z.object({
  duckdbPath: z.string().min(1, 'duckdbPath is required'),
  callerName: z.string().optional(),
  fromISO: z.string().min(1, 'fromISO is required'),
  toISO: z.string().min(1, 'toISO is required'),
  limit: z.number().int().min(1).max(10000).optional().default(1000),
});

export type QueryCallsDuckdbSpec = z.infer<typeof QueryCallsDuckdbSpecSchema>;

/**
 * Query Calls Result (JSON-serializable)
 */
export type QueryCallsDuckdbResult = {
  calls: CallRecord[];
  totalQueried: number;
  totalReturned: number;
  fromISO: string;
  toISO: string;
  callerName?: string;
  error?: string; // Error message if query failed
};

/**
 * Extended WorkflowContext for querying calls
 */
export type QueryCallsDuckdbContext = WorkflowContext & {
  services: {
    duckdbStorage: {
      queryCalls: (
        path: string,
        limit: number,
        excludeUnrecoverable?: boolean,
        callerName?: string
      ) => Promise<{
        success: boolean;
        calls?: Array<{ mint: string; alert_timestamp: string; caller_name?: string | null }>;
        error?: string;
      }>;
    };
  };
};

/**
 * Create context for queryCallsDuckdb workflow
 *
 * This creates a production context with DuckDB storage service.
 * For use in production code (e.g., CallDataLoader).
 */
export async function createQueryCallsDuckdbContext(
  duckdbPath?: string
): Promise<QueryCallsDuckdbContext> {
  const { createProductionContext } = await import('../context/createProductionContext.js');
  const { DuckDBStorageService } = await import('@quantbot/backtest');
  const { PythonEngine } = await import('@quantbot/utils');

  const baseContext = createProductionContext();
  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);

  return {
    ...baseContext,
    services: {
      duckdbStorage: {
        queryCalls: async (
          path: string,
          limit: number,
          excludeUnrecoverable?: boolean,
          callerName?: string
        ) => {
          const result = await duckdbStorage.queryCalls(
            path,
            limit,
            excludeUnrecoverable,
            callerName
          );
          // Convert null to undefined for error field to match expected type
          return {
            ...result,
            error: result.error ?? undefined,
          };
        },
      },
    },
  };
}

/**
 * Create default context (for testing)
 */
export function createDefaultQueryCallsDuckdbContext(): QueryCallsDuckdbContext {
  throw new ConfigurationError(
    'createDefaultQueryCallsDuckdbContext must be implemented with actual services. Use createQueryCallsDuckdbContext() in production.',
    'QueryCallsDuckdbContext',
    { operation: 'createDefaultQueryCallsDuckdbContext' }
  );
}

/**
 * Query calls from DuckDB
 */
export async function queryCallsDuckdb(
  spec: QueryCallsDuckdbSpec,
  ctx: QueryCallsDuckdbContext = createDefaultQueryCallsDuckdbContext()
): Promise<QueryCallsDuckdbResult> {
  // Validate spec
  const parsed = QueryCallsDuckdbSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid query calls spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;

  // Validate date range
  const fromDate = DateTime.fromISO(validated.fromISO, { zone: 'utc' });
  const toDate = DateTime.fromISO(validated.toISO, { zone: 'utc' });
  if (toDate <= fromDate) {
    throw new ValidationError(`Invalid date range: toISO must be after fromISO`, {
      fromISO: validated.fromISO,
      toISO: validated.toISO,
    });
  }

  ctx.logger.info('[workflows.queryCallsDuckdb] Querying calls', {
    duckdbPath: validated.duckdbPath,
    callerName: validated.callerName,
    fromISO: validated.fromISO,
    toISO: validated.toISO,
    limit: validated.limit,
  });

  // Query calls from DuckDB (pass callerName if provided)
  const result = await ctx.services.duckdbStorage.queryCalls(
    validated.duckdbPath,
    validated.limit,
    true, // excludeUnrecoverable
    validated.callerName
  );

  if (!result.success || !result.calls) {
    const errorMsg = result.error || 'Unknown error querying calls';
    
    // Check for table missing error and provide helpful guidance
    if (errorMsg.includes("Table 'user_calls_d' not found") || errorMsg.includes('user_calls_d')) {
      throw new ConfigurationError(
        `Missing user_calls_d table in DuckDB. Please ingest Telegram data first:\n\n` +
        `  quantbot ingestion telegram --file <telegram-export.json>\n\n` +
        `Or create the table schema manually using the migration script.\n` +
        `Database path: ${validated.duckdbPath}`,
        'QueryCallsDuckdb',
        { duckdbPath: validated.duckdbPath, error: errorMsg }
      );
    }
    
    ctx.logger.warn('[workflows.queryCallsDuckdb] Failed to query calls', {
      error: errorMsg,
      duckdbPath: validated.duckdbPath,
    });
    return {
      calls: [],
      totalQueried: 0,
      totalReturned: 0,
      fromISO: validated.fromISO,
      toISO: validated.toISO,
      callerName: validated.callerName,
      error: errorMsg, // Include error in result for better debugging
    };
  }

  // Filter by date range (caller name filtering is done in the database query)
  const filtered = result.calls
    .filter((call) => {
      const callDate = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' });
      return callDate >= fromDate && callDate <= toDate;
    })
    .map((call, index) => ({
      id: `call_${call.mint}_${call.alert_timestamp}_${index}`,
      caller: call.caller_name || 'unknown', // Use actual caller_name from database
      mint: call.mint,
      createdAt: DateTime.fromISO(call.alert_timestamp, { zone: 'utc' }),
    }));

  // Log date range info for debugging
  if (result.calls.length > 0 && filtered.length === 0) {
    const dates = result.calls.map((c) => DateTime.fromISO(c.alert_timestamp, { zone: 'utc' }));
    if (dates.length > 0) {
      const minDate = DateTime.min(...dates);
      const maxDate = DateTime.max(...dates);
      if (minDate && maxDate) {
        ctx.logger.warn('[workflows.queryCallsDuckdb] No calls in date range', {
          requestedRange: { from: validated.fromISO, to: validated.toISO },
          actualRange: {
            earliest: minDate.toISO(),
            latest: maxDate.toISO(),
          },
          totalQueried: result.calls.length,
        });
      }
    }
  }

  ctx.logger.info('[workflows.queryCallsDuckdb] Query complete', {
    totalQueried: result.calls.length,
    totalReturned: filtered.length,
    fromISO: validated.fromISO,
    toISO: validated.toISO,
    callerName: validated.callerName,
  });

  return {
    calls: filtered,
    totalQueried: result.calls.length,
    totalReturned: filtered.length,
    fromISO: validated.fromISO,
    toISO: validated.toISO,
    callerName: validated.callerName,
  };
}
