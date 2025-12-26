/**
 * Lab Overlay Backtesting Handler
 * ================================
 * Quick overlay backtesting for exit strategy experimentation
 *
 * Queries calls from DuckDB and runs overlay backtesting to evaluate exit strategies.
 */

import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import type { LabRunArgs } from '../../command-defs/lab.js';
import { evaluateCallsWorkflow, createProductionContextWithPorts } from '@quantbot/workflows';
import type { EvaluateCallsRequest } from '@quantbot/workflows';
import type { CallSignal } from '@quantbot/core';

export interface LabRunResult {
  success: boolean;
  callsSimulated: number;
  callsSucceeded: number;
  callsFailed: number;
  results: Array<{
    callId: string;
    mint: string;
    createdAtISO: string;
    overlay: string;
    ok: boolean;
    netReturnPct?: number;
    grossReturnPct?: number;
    exitReason?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
  summary: {
    byOverlay: Array<{
      overlay: string;
      calls: number;
      medianNetReturnPct: number;
      winRate: number;
    }>;
    overall: {
      avgNetReturnPct?: number;
      minNetReturnPct?: number;
      maxNetReturnPct?: number;
      winRate?: number;
      successRate?: number;
      failureRate?: number;
    };
  };
}

/**
 * Convert DuckDB call to CallSignal format
 */
function convertDuckDBCallToCallSignal(call: {
  mint: string;
  alert_timestamp: string;
  caller_name?: string | null;
  price_usd?: number | null;
}): CallSignal {
  const alertTimestamp = DateTime.fromISO(call.alert_timestamp);
  const tsMs = alertTimestamp.toMillis();

  // Determine chain from mint address format (simplified - assumes Solana)
  const chain: CallSignal['token']['chain'] = 'sol';

  // Generate caller identity from caller_name
  const callerName = call.caller_name || 'unknown';
  const fromId = callerName.toLowerCase().replace(/\s+/g, '-');

  return {
    kind: 'token_call',
    tsMs,
    token: {
      address: call.mint,
      chain,
    },
    caller: {
      displayName: callerName,
      fromId,
    },
    source: {
      callerMessageId: 0, // Not available from DuckDB
    },
    enrichment: call.price_usd
      ? {
          tsMs,
          enricher: {
            displayName: 'DuckDB',
            fromId: 'duckdb',
          },
          snapshot: {
            priceUsd: call.price_usd,
          },
        }
      : undefined,
    parse: {
      confidence: 1.0,
      reasons: ['from_duckdb'],
    },
  };
}

export async function runLabHandler(args: LabRunArgs, ctx: CommandContext): Promise<LabRunResult> {
  // Get calls from DuckDB storage
  const duckdbStorage = ctx.services.duckdbStorage();
  const dbPath = process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const fromDate = args.from ? DateTime.fromISO(args.from) : DateTime.now().minus({ days: 7 });
  const toDate = args.to ? DateTime.fromISO(args.to) : DateTime.now();

  // Query calls from DuckDB
  const callsResult = await duckdbStorage.queryCalls(
    dbPath,
    args.limit * 2, // Get more to account for filtering
    false, // excludeUnrecoverable
    args.caller
  );

  if (!callsResult.success || !callsResult.calls) {
    throw new Error(callsResult.error || 'Failed to query calls from DuckDB');
  }

  // Filter calls by date range and mint if specified
  let calls = callsResult.calls.filter((call) => {
    const callDate = DateTime.fromISO(call.alert_timestamp);
    if (callDate < fromDate || callDate > toDate) {
      return false;
    }
    if (args.mint && call.mint !== args.mint) {
      return false;
    }
    return true;
  });

  // Limit results
  if (calls.length > args.limit) {
    calls = calls.slice(0, args.limit);
  }

  if (calls.length === 0) {
    return {
      success: true,
      callsSimulated: 0,
      callsSucceeded: 0,
      callsFailed: 0,
      results: [],
      summary: {
        byOverlay: [],
        overall: {},
      },
    };
  }

  // Convert DuckDB calls to CallSignal format
  const callSignals: CallSignal[] = calls.map(convertDuckDBCallToCallSignal);

  // Build workflow request
  const request: EvaluateCallsRequest = {
    calls: callSignals,
    align: {
      lagMs: args.lagMs,
      entryRule: args.entryRule,
      timeframeMs: args.timeframeMs,
      interval: args.interval,
    },
    backtest: {
      fee: {
        takerFeeBps: args.takerFeeBps,
        slippageBps: args.slippageBps,
      },
      overlays: args.overlays,
      position: {
        notionalUsd: args.notionalUsd,
      },
    },
  };

  // Create production context with storage-based market data adapter (for lab)
  // Lab uses DuckDB/ClickHouse instead of API calls
  const baseContext = await createProductionContextWithPorts();
  const { createMarketDataStorageAdapter } = await import('@quantbot/workflows');

  // Override market data port to use storage instead of API
  const workflowCtx = {
    ...baseContext,
    ports: {
      ...baseContext.ports,
      marketData: createMarketDataStorageAdapter(),
    },
  };

  // Run overlay backtesting workflow
  const workflowResult = await evaluateCallsWorkflow(request, workflowCtx);

  // Transform workflow results to lab format
  const results: LabRunResult['results'] = [];
  const overlayStats = new Map<string, { returns: number[]; wins: number; total: number }>();

  for (const result of workflowResult.results) {
    const overlayKey = JSON.stringify(result.overlay);
    const netReturnPct = result.pnl.netReturnPct;
    const grossReturnPct = result.pnl.grossReturnPct;
    const isWin = netReturnPct > 0;

    // Update overlay stats
    if (!overlayStats.has(overlayKey)) {
      overlayStats.set(overlayKey, { returns: [], wins: 0, total: 0 });
    }
    const stats = overlayStats.get(overlayKey)!;
    stats.returns.push(netReturnPct);
    stats.total++;
    if (isWin) stats.wins++;

    // Convert tsMs to ISO string
    const createdAtISO = DateTime.fromMillis(result.call.tsMs).toISO()!;

    // Add result
    results.push({
      callId: `${result.call.token.address}_${createdAtISO}`,
      mint: result.call.token.address,
      createdAtISO,
      overlay: overlayKey,
      ok: result.diagnostics.tradeable,
      netReturnPct,
      grossReturnPct,
      exitReason: result.exit.reason,
      errorCode: result.diagnostics.tradeable ? undefined : 'NOT_TRADEABLE',
      errorMessage: result.diagnostics.skippedReason,
    });
  }

  // Build summary
  const byOverlay: LabRunResult['summary']['byOverlay'] = [];
  for (const [overlayKey, stats] of overlayStats.entries()) {
    const sortedReturns = [...stats.returns].sort((a, b) => a - b);
    const medianNetReturnPct =
      sortedReturns.length > 0 ? sortedReturns[Math.floor(sortedReturns.length / 2)] : 0;
    const winRate = stats.total > 0 ? stats.wins / stats.total : 0;

    byOverlay.push({
      overlay: overlayKey,
      calls: stats.total,
      medianNetReturnPct,
      winRate,
    });
  }

  // Sort by median return (descending)
  byOverlay.sort((a, b) => b.medianNetReturnPct - a.medianNetReturnPct);

  // Calculate overall stats
  const allReturns = Array.from(overlayStats.values()).flatMap((s) => s.returns);
  const allWins = Array.from(overlayStats.values()).reduce((sum, s) => sum + s.wins, 0);
  const allTotal = Array.from(overlayStats.values()).reduce((sum, s) => sum + s.total, 0);
  const successfulResults = results.filter((r) => r.ok);
  const failedResults = results.filter((r) => !r.ok);

  const overall = {
    avgNetReturnPct:
      allReturns.length > 0 ? allReturns.reduce((a, b) => a + b, 0) / allReturns.length : undefined,
    minNetReturnPct: allReturns.length > 0 ? Math.min(...allReturns) : undefined,
    maxNetReturnPct: allReturns.length > 0 ? Math.max(...allReturns) : undefined,
    winRate: allTotal > 0 ? allWins / allTotal : undefined,
    successRate: results.length > 0 ? successfulResults.length / results.length : undefined,
    failureRate: results.length > 0 ? failedResults.length / results.length : undefined,
  };

  return {
    success: true,
    callsSimulated: calls.length,
    callsSucceeded: successfulResults.length,
    callsFailed: failedResults.length,
    results,
    summary: {
      byOverlay,
      overall,
    },
  };
}
