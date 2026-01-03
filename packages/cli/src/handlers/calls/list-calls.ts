/**
 * List Calls Handler
 *
 * Lists calls from DuckDB in a readable format
 */

import { resolve } from 'path';
import type { CommandContext } from '../../core/command-context.js';
import { queryCallsDuckdb, type QueryCallsDuckdbContext } from '@quantbot/workflows';
import type { ListCallsArgs } from '../../command-defs/calls.js';
import { logger } from '@quantbot/utils';
import { SystemClockAdapter } from '../../core/clock-adapter.js';
import { v4 as uuidv4 } from 'uuid';

export async function listCallsHandler(
  args: ListCallsArgs,
  _ctx: CommandContext
): Promise<{ calls: unknown[]; total: number; dateRange?: { from?: string; to?: string } }> {
  // Resolve path to absolute
  const duckdbPath = resolve(process.cwd(), args.duckdb);
  const limit = args.limit || 1000;

  // If no date range specified, use a wide range to get all calls
  const fromISO = args.fromIso || '2000-01-01';
  const toISO = args.toIso || '2100-12-31';

  // Create minimal context without StorageEngine (which requires Birdeye keys)
  const { PythonEngine } = await import('@quantbot/utils');
  const { DuckDBStorageService } = await import('@quantbot/simulation');
  const pythonEngine = new PythonEngine();
  const duckdbStorage = new DuckDBStorageService(pythonEngine);

  // Create minimal workflow context (no StorageEngine, no Birdeye dependencies)
  // Stub out unused parts of WorkflowContext that queryCallsDuckdb doesn't need
  const systemClock = new SystemClockAdapter();
  const ctx: QueryCallsDuckdbContext = {
    logger: {
      info: (msg: string, context?: unknown) =>
        logger.info(msg, context as Record<string, unknown> | undefined),
      warn: (msg: string, context?: unknown) =>
        logger.warn(msg, context as Record<string, unknown> | undefined),
      error: (msg: string, context?: unknown) =>
        logger.error(msg, context as Record<string, unknown> | undefined),
      debug: (msg: string, context?: unknown) =>
        logger.debug(msg, context as Record<string, unknown> | undefined),
    },
    clock: { nowISO: () => new Date(systemClock.nowMs()).toISOString() },
    ids: { newRunId: () => `list_${uuidv4()}` },
    repos: {
      strategies: { getByName: async () => null },
      calls: { list: async () => [] },
      simulationRuns: { create: async () => {} },
      simulationResults: { insertMany: async () => {} },
    },
    ohlcv: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      causalAccessor: null as any, // Not used by queryCallsDuckdb
    },
    simulation: {
      run: async () => ({ pnlMultiplier: 0, trades: 0 }),
    },
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
          return {
            ...result,
            error: result.error ?? undefined,
          };
        },
      },
    },
  };

  const result = await queryCallsDuckdb(
    {
      duckdbPath,
      fromISO,
      toISO,
      callerName: args.callerName,
      limit,
    },
    ctx
  );

  // Check for errors
  if (result.error) {
    throw new Error(`Failed to query calls from DuckDB: ${result.error}`);
  }

  // Format calls for display
  const formattedCalls = result.calls.map((call) => ({
    mint: call.mint,
    caller: call.caller || 'unknown',
    timestamp: call.createdAt.toISO(),
    date: call.createdAt.toISODate(),
    time: call.createdAt.toISOTime({ includeOffset: false }),
  }));

  return {
    calls: formattedCalls,
    total: formattedCalls.length,
    dateRange: args.fromIso || args.toIso ? { from: fromISO, to: toISO } : undefined,
  };
}
