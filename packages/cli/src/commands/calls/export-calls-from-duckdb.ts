/**
 * Export Calls from DuckDB to CallSignal JSON
 *
 * Converts DuckDB user_calls_d table to CallSignal[] format
 * for use with evaluate/sweep commands.
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import type { CommandContext } from '../../core/command-context.js';
import type { CallSignal } from '@quantbot/core';
import type { ExportCallsArgs } from '../../command-defs/calls.js';
import { queryCallsDuckdb, createProductionContext } from '@quantbot/workflows';
import { DateTime } from 'luxon';

/**
 * Convert DuckDB call to CallSignal
 *
 * Note: This is a simplified conversion. Real implementation would:
 * - Map chain from bot reply metadata
 * - Extract enrichment data from bot replies
 * - Handle missing fields gracefully
 */
function convertToCallSignal(
  call: { mint: string; alert_timestamp: string },
  index: number
): CallSignal {
  const tsMs = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' }).toMillis();

  return {
    kind: 'token_call',
    tsMs,
    token: {
      address: call.mint,
      chain: 'bsc', // Default to BSC for now - could be enhanced to detect from metadata
    },
    caller: {
      displayName: 'Unknown', // Would come from caller_name in DuckDB
      fromId: `caller_${index}`,
    },
    source: {
      callerMessageId: index,
    },
    parse: {
      confidence: 0.8, // Medium confidence for DuckDB imports
      reasons: ['duckdb_import'],
    },
  };
}

export async function exportCallsFromDuckdbHandler(args: ExportCallsArgs, _ctx: CommandContext) {
  // Query calls from DuckDB
  const workflowCtx = createProductionContext();

  // Create context with duckdbStorage service
  const { PythonEngine } = await import('@quantbot/utils');
  const { DuckDBStorageService } = await import('@quantbot/simulation');
  const engine = new PythonEngine();
  const storage = new DuckDBStorageService(engine);

  // Resolve path to absolute - Python script runs from tools/simulation, so relative paths break
  const duckdbPathRaw = args.duckdbPath;
  const duckdbPath = resolve(process.cwd(), duckdbPathRaw);
  const fromISO = args.fromIso;
  const toISO = args.toIso;
  const callerName = args.callerName;
  const limit = args.limit || 200;

  const result = await queryCallsDuckdb(
    {
      duckdbPath,
      fromISO,
      toISO,
      callerName,
      limit,
    },
    {
      ...workflowCtx,
      services: {
        duckdbStorage: {
          queryCalls: async (path: string, limit: number) => {
            const result = await storage.queryCalls(path, limit);
            // Convert error from string | null to string | undefined
            return {
              ...result,
              error: result.error ?? undefined,
            };
          },
        },
      },
    }
  );

  // Convert to CallSignal[]
  const callSignals: CallSignal[] = result.calls.map(
    (call: { mint: string; createdAt: { toISO: () => string | null } }, index: number) =>
      convertToCallSignal(
        {
          mint: call.mint,
          alert_timestamp: call.createdAt.toISO()!,
        },
        index
      )
  );

  // Write to output file
  writeFileSync(args.out, JSON.stringify(callSignals, null, 2), 'utf-8');

  return {
    exported: callSignals.length,
    outputFile: args.out,
    fromISO,
    toISO,
  };
}
