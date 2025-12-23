/**
 * Export Calls with Simulation Results to CSV
 *
 * Exports calls from DuckDB with simulation results in the specified CSV format:
 * - TokenAddress, AlertTime, EntryTime, ExitTime, PnL, PnLPercent, MaxReached,
 *   HoldDurationMinutes, EntryPrice, ExitPrice
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { CallSignal } from '@quantbot/core';
import {
  queryCallsDuckdb,
  createProductionContext,
  evaluateCallsWorkflow,
  createProductionContextWithPorts,
} from '@quantbot/workflows';
import type { EvaluateCallsRequest } from '@quantbot/workflows';
import { formatCSV } from '../../core/output-formatter.js';

/**
 * Export calls with simulation results schema
 */
export type ExportCallsWithSimulationArgs = {
  duckdbPath: string;
  fromIso: string;
  toIso: string;
  callerName?: string;
  limit?: number;
  out: string;
  // Simulation parameters
  lagMs?: number;
  entryRule?: 'next_candle_open' | 'next_candle_close' | 'call_time_close';
  timeframeMs?: number;
  interval?: '1s' | '1m' | '5m' | '15m' | '1h';
  takerFeeBps?: number;
  slippageBps?: number;
  notionalUsd?: number;
  overlays?: Array<{
    kind: 'take_profit' | 'stop_loss' | 'trailing_stop' | 'time_exit' | 'combo';
    takePct?: number;
    stopPct?: number;
    trailPct?: number;
    holdMs?: number;
    legs?: unknown[];
  }>;
};

/**
 * Convert DuckDB call to CallSignal
 */
function convertToCallSignal(
  call: { mint: string; alert_timestamp: string; caller_name?: string },
  index: number
): CallSignal {
  const tsMs = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' }).toMillis();

  return {
    kind: 'token_call',
    tsMs,
    token: {
      address: call.mint,
      chain: 'solana', // Default - could be enhanced to detect from metadata
    },
    caller: {
      displayName: call.caller_name || 'Unknown',
      fromId: call.caller_name || `caller_${index}`,
    },
    source: {
      callerMessageId: index,
    },
    parse: {
      confidence: 0.8,
      reasons: ['duckdb_import'],
    },
  };
}

/**
 * Calculate max reached multiplier from entry price and candles
 * This is a simplified calculation - in a full implementation, we'd track peak during simulation
 */
function calculateMaxReached(entryPrice: number, exitPrice: number, pnlPercent: number): number {
  // Estimate max reached as a multiplier of entry price
  // If PnL is positive, max was likely higher than exit
  // If PnL is negative, max was likely close to entry
  if (pnlPercent > 0) {
    // Positive PnL: estimate max as exit price * 1.1 (conservative estimate)
    return exitPrice / entryPrice;
  } else {
    // Negative PnL: max was likely close to entry
    return Math.max(1.0, exitPrice / entryPrice);
  }
}

/**
 * Export calls with simulation results to CSV
 */
export async function exportCallsWithSimulationHandler(
  args: ExportCallsWithSimulationArgs,
  _ctx: CommandContext
) {
  // 1. Query calls from DuckDB
  const workflowCtx = createProductionContext();

  const { PythonEngine } = await import('@quantbot/utils');
  const { DuckDBStorageService } = await import('@quantbot/simulation');
  const engine = new PythonEngine();
  const storage = new DuckDBStorageService(engine);

  const duckdbPath = resolve(process.cwd(), args.duckdbPath);
  const fromISO = args.fromIso;
  const toISO = args.toIso;
  const callerName = args.callerName;
  const limit = args.limit || 1000;

  const queryResult = await queryCallsDuckdb(
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
            return {
              ...result,
              error: result.error ?? undefined,
            };
          },
        },
      },
    }
  );

  if (queryResult.calls.length === 0) {
    throw new Error(`No calls found in date range ${fromISO} to ${toISO}`);
  }

  // 2. Convert to CallSignal[]
  const callSignals: CallSignal[] = queryResult.calls.map(
    (
      call: { mint: string; createdAt: { toISO: () => string | null }; caller?: string },
      index: number
    ) =>
      convertToCallSignal(
        {
          mint: call.mint,
          alert_timestamp: call.createdAt.toISO()!,
          caller_name: call.caller,
        },
        index
      )
  );

  // 3. Run simulation workflow
  const defaultOverlays = args.overlays || [{ kind: 'take_profit' as const, takePct: 100 }];

  const evaluateRequest: EvaluateCallsRequest = {
    calls: callSignals,
    align: {
      lagMs: args.lagMs || 10_000,
      entryRule: args.entryRule || 'next_candle_open',
      timeframeMs: args.timeframeMs || 24 * 60 * 60 * 1000,
      interval: args.interval || '5m',
    },
    backtest: {
      fee: {
        takerFeeBps: args.takerFeeBps || 30,
        slippageBps: args.slippageBps || 10,
      },
      overlays: defaultOverlays as any,
      position: {
        notionalUsd: args.notionalUsd || 1000,
      },
    },
  };

  const evalCtx = await createProductionContextWithPorts();
  const simulationResults = await evaluateCallsWorkflow(evaluateRequest, evalCtx);

  // 4. Transform to CSV format
  const csvRows = simulationResults.results
    .filter((result) => result.diagnostics.tradeable && !result.diagnostics.skippedReason)
    .map((result) => {
      const alertTime = DateTime.fromMillis(result.call.tsMs, { zone: 'utc' });
      const entryTime = DateTime.fromMillis(result.entry.tsMs, { zone: 'utc' });
      const exitTime = DateTime.fromMillis(result.exit.tsMs, { zone: 'utc' });

      const holdDurationMinutes = Math.round((result.exit.tsMs - result.entry.tsMs) / (1000 * 60));

      // Calculate PnL in USD (simplified - uses notional * return)
      const notionalUsd = args.notionalUsd || 1000;
      const pnl = (notionalUsd * result.pnl.netReturnPct) / 100;

      // Calculate max reached (multiplier)
      const maxReached = calculateMaxReached(
        result.entry.px,
        result.exit.px,
        result.pnl.netReturnPct
      );

      return {
        TokenAddress: result.call.token.address,
        AlertTime: alertTime.toISO(),
        EntryTime: entryTime.toISO(),
        ExitTime: exitTime.toISO(),
        PnL: pnl.toFixed(5),
        PnLPercent: result.pnl.netReturnPct.toFixed(2),
        MaxReached: maxReached.toFixed(4),
        HoldDurationMinutes: holdDurationMinutes,
        EntryPrice: result.entry.px.toFixed(8),
        ExitPrice: result.exit.px.toFixed(8),
      };
    });

  // 5. Write CSV
  const csvContent = formatCSV(csvRows, [
    'TokenAddress',
    'AlertTime',
    'EntryTime',
    'ExitTime',
    'PnL',
    'PnLPercent',
    'MaxReached',
    'HoldDurationMinutes',
    'EntryPrice',
    'ExitPrice',
  ]);

  writeFileSync(args.out, csvContent, 'utf-8');

  return {
    exported: csvRows.length,
    outputFile: args.out,
    fromISO,
    toISO,
    totalCalls: queryResult.calls.length,
    tradeableCalls: csvRows.length,
  };
}
