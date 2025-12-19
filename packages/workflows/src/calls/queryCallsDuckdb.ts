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
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/utils';
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
};

/**
 * Extended WorkflowContext for querying calls
 */
export type QueryCallsDuckdbContext = WorkflowContext & {
  services: {
    duckdbStorage: {
      queryCalls: (
        path: string,
        limit: number
      ) => Promise<{
        success: boolean;
        calls?: Array<{ mint: string; alert_timestamp: string }>;
        error?: string;
      }>;
    };
  };
};

/**
 * Query calls from DuckDB
 */
export async function queryCallsDuckdb(
  spec: QueryCallsDuckdbSpec,
  ctx: QueryCallsDuckdbContext
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

  // Query calls from DuckDB
  const result = await ctx.services.duckdbStorage.queryCalls(validated.duckdbPath, validated.limit);

  if (!result.success || !result.calls) {
    ctx.logger.warn('[workflows.queryCallsDuckdb] Failed to query calls', {
      error: result.error,
      duckdbPath: validated.duckdbPath,
    });
    return {
      calls: [],
      totalQueried: 0,
      totalReturned: 0,
      fromISO: validated.fromISO,
      toISO: validated.toISO,
      callerName: validated.callerName,
    };
  }

  // Filter by date range and caller name
  const filtered = result.calls
    .filter((call) => {
      const callDate = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' });
      return callDate >= fromDate && callDate <= toDate;
    })
    .map((call, index) => ({
      id: `call_${call.mint}_${call.alert_timestamp}_${index}`,
      caller: validated.callerName || 'unknown',
      mint: call.mint,
      createdAt: DateTime.fromISO(call.alert_timestamp, { zone: 'utc' }),
    }));

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
