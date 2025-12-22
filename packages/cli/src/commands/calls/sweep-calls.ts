/**
 * Sweep Calls Handler
 *
 * Runs evaluateCallsWorkflow across a grid of parameters:
 * - Multiple intervals (1m, 5m, etc.)
 * - Multiple lags (0ms, 10s, 30s, 60s, etc.)
 * - Multiple overlay sets
 *
 * Writes deterministic outputs:
 * - per_call.jsonl (one row per call × overlay × lag × interval)
 * - per_caller.jsonl (aggregated by caller per configuration)
 * - matrix.json (aggregated by caller × lag × interval × overlaySet)
 * - run.meta.json (metadata: git sha, config hash, timestamps)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { evaluateCallsWorkflow, createProductionContextWithPorts } from '@quantbot/workflows';
import type {
  EvaluateCallsRequest,
  EvaluateCallsOutput,
  CallerSummary,
  CallBacktestResult,
} from '@quantbot/workflows';
import type { CallSignal } from '@quantbot/core';
import type { ExitOverlay } from '@quantbot/simulation';
import type { SweepCallsArgs } from '../../command-defs/calls.js';

/**
 * Per-call JSONL row (one per call × overlay × lag × interval)
 */
type PerCallRow = {
  // Sweep metadata
  sweepId: string;
  lagMs: number;
  interval: string;
  overlaySetId: string;
  overlayIndex: number;
  
  // Call metadata
  callTsMs: number;
  callerFromId: string;
  callerName: string;
  tokenAddress: string;
  tokenChain: string;
  
  // Result
  overlay: ExitOverlay;
  entry: { tsMs: number; px: number };
  exit: { tsMs: number; px: number; reason: string };
  pnl: {
    grossReturnPct: number;
    netReturnPct: number;
    feesUsd: number;
    slippageUsd: number;
  };
  diagnostics: {
    candlesUsed: number;
    tradeable: boolean;
    skippedReason?: string;
  };
};

/**
 * Per-caller JSONL row (one per caller × lag × interval × overlaySet)
 */
type PerCallerRow = {
  // Sweep metadata
  sweepId: string;
  lagMs: number;
  interval: string;
  overlaySetId: string;
  
  // Caller summary
  callerFromId: string;
  callerName: string;
  calls: number;
  tradeableCalls: number;
  medianNetReturnPct: number;
  winRate: number;
  bestOverlay?: ExitOverlay;
};

/**
 * Matrix aggregation key
 */
type MatrixKey = {
  callerFromId: string;
  lagMs: number;
  interval: string;
  overlaySetId: string;
};

/**
 * Matrix value (aggregated stats)
 */
type MatrixValue = {
  callerName: string;
  calls: number;
  tradeableCalls: number;
  medianNetReturnPct: number;
  winRate: number;
  meanNetReturnPct: number;
  minNetReturnPct: number;
  maxNetReturnPct: number;
  bestOverlay?: ExitOverlay;
};

/**
 * Run metadata
 */
type RunMetadata = {
  sweepId: string;
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
  gitSha: string;
  configHash: string;
  config: {
    callCount: number;
    intervals: string[];
    lagsMs: number[];
    overlaySetCount: number;
    overlaySetIds: string[];
  };
  counts: {
    totalRuns: number;
    totalResults: number;
    totalCallerSummaries: number;
  };
};

/**
 * Get git SHA (or "unknown" if not in git repo)
 */
function getGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Generate config hash for reproducibility
 */
function generateConfigHash(
  calls: CallSignal[],
  intervals: string[],
  lagsMs: number[],
  overlaySets: ExitOverlay[][]
): string {
  const config = {
    callCount: calls.length,
    intervals: intervals.sort(),
    lagsMs: lagsMs.sort((a, b) => a - b),
    overlaySetCount: overlaySets.length,
    overlaySetIds: overlaySets.map((_, i) => `set-${i}`),
  };
  const json = JSON.stringify(config);
  return createHash('sha256').update(json).digest('hex').substring(0, 16);
}

/**
 * Generate sweep ID from timestamp
 */
function generateSweepId(): string {
  return `sweep-${DateTime.utc().toFormat('yyyyMMdd-HHmmss')}`;
}

/**
 * Convert CallBacktestResult to PerCallRow
 */
function resultToPerCallRow(
  result: CallBacktestResult,
  sweepId: string,
  lagMs: number,
  interval: string,
  overlaySetId: string,
  overlayIndex: number
): PerCallRow {
  return {
    sweepId,
    lagMs,
    interval,
    overlaySetId,
    overlayIndex,
    callTsMs: result.call.tsMs,
    callerFromId: result.call.caller.fromId,
    callerName: result.call.caller.displayName,
    tokenAddress: result.call.token.address,
    tokenChain: result.call.token.chain,
    overlay: result.overlay,
    entry: result.entry,
    exit: result.exit,
    pnl: result.pnl,
    diagnostics: result.diagnostics,
  };
}

/**
 * Convert CallerSummary to PerCallerRow
 */
function summaryToPerCallerRow(
  summary: CallerSummary,
  sweepId: string,
  lagMs: number,
  interval: string,
  overlaySetId: string
): PerCallerRow {
  return {
    sweepId,
    lagMs,
    interval,
    overlaySetId,
    callerFromId: summary.callerFromId,
    callerName: summary.callerName,
    calls: summary.calls,
    tradeableCalls: summary.tradeableCalls,
    medianNetReturnPct: summary.medianNetReturnPct,
    winRate: summary.winRate,
    bestOverlay: summary.bestOverlay,
  };
}

/**
 * Aggregate results into matrix
 */
function aggregateMatrix(
  perCallRows: PerCallRow[],
  perCallerRows: PerCallerRow[]
): Record<string, MatrixValue> {
  const matrix: Record<string, MatrixValue> = {};

  // Group per-caller rows by key
  for (const row of perCallerRows) {
    const key: MatrixKey = {
      callerFromId: row.callerFromId,
      lagMs: row.lagMs,
      interval: row.interval,
      overlaySetId: row.overlaySetId,
    };
    const keyStr = JSON.stringify(key);

    // Get all per-call rows for this key to compute additional stats
    const callRows = perCallRows.filter(
      (r) =>
        r.callerFromId === row.callerFromId &&
        r.lagMs === row.lagMs &&
        r.interval === row.interval &&
        r.overlaySetId === row.overlaySetId &&
        r.diagnostics.tradeable &&
        !r.diagnostics.skippedReason
    );

    const netReturns = callRows.map((r) => r.pnl.netReturnPct).sort((a, b) => a - b);
    const meanNetReturnPct =
      netReturns.length > 0 ? netReturns.reduce((a, b) => a + b, 0) / netReturns.length : 0;

    matrix[keyStr] = {
      callerName: row.callerName,
      calls: row.calls,
      tradeableCalls: row.tradeableCalls,
      medianNetReturnPct: row.medianNetReturnPct,
      winRate: row.winRate,
      meanNetReturnPct,
      minNetReturnPct: netReturns.length > 0 ? netReturns[0] : 0,
      maxNetReturnPct: netReturns.length > 0 ? netReturns[netReturns.length - 1] : 0,
      bestOverlay: row.bestOverlay,
    };
  }

  return matrix;
}

export async function sweepCallsHandler(args: SweepCallsArgs, _ctx: CommandContext) {
  // Load calls
  let calls: CallSignal[];
  const callsFile = (args as any)['calls-file'] || (args as any).callsFile;
  try {
    const fileContent = readFileSync(callsFile, 'utf-8');
    const parsed = JSON.parse(fileContent);
    if (!Array.isArray(parsed)) {
      throw new Error('Calls file must contain a JSON array of CallSignal objects');
    }
    calls = parsed as CallSignal[];
  } catch (error) {
    throw new Error(
      `Failed to load calls from ${callsFile}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Load overlay sets
  let overlaySets: ExitOverlay[][];
  const overlaysFile = (args as any)['overlays-file'] || (args as any).overlaysFile;
  const overlaySetsFile = (args as any)['overlay-sets-file'] || (args as any).overlaySetsFile;
  if (overlaysFile) {
    try {
      const fileContent = readFileSync(overlaysFile, 'utf-8');
      const parsed = JSON.parse(fileContent);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Overlays file must contain a JSON array of ExitOverlay arrays');
      }
      overlaySets = parsed as ExitOverlay[][];
    } catch (error) {
      throw new Error(
        `Failed to load overlays from ${overlaysFile}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else if (overlaySetsFile) {
    try {
      const fileContent = readFileSync(overlaySetsFile, 'utf-8');
      const parsed = JSON.parse(fileContent);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('Overlay sets file must contain a JSON array of ExitOverlay arrays');
      }
      overlaySets = parsed as ExitOverlay[][];
    } catch (error) {
      throw new Error(
        `Failed to load overlay sets from ${overlaySetsFile}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  } else {
    throw new Error('Either --overlays-file or --overlay-sets-file is required');
  }

  // Parse intervals and lags
  const intervals = args.intervals;
  const lagsMs = (args as any)['lags-ms'] || (args as any).lagsMs;

  // Generate sweep metadata
  const sweepId = generateSweepId();
  const configHash = generateConfigHash(calls, intervals, lagsMs, overlaySets);
  const gitSha = getGitSha();
  const startedAt = DateTime.utc();
  const startedAtISO = startedAt.toISO()!;

  // Create output directory
  mkdirSync(args.out, { recursive: true });

  // Open output files
  const perCallPath = join(args.out, 'per_call.jsonl');
  const perCallerPath = join(args.out, 'per_caller.jsonl');
  const matrixPath = join(args.out, 'matrix.json');
  const metaPath = join(args.out, 'run.meta.json');

  // Collect all results
  const allPerCallRows: PerCallRow[] = [];
  const allPerCallerRows: PerCallerRow[] = [];

  // Create production context (reuse across runs)
  const ctx = await createProductionContextWithPorts();

  // Run sweep (deterministic, no parallelization)
  let totalRuns = 0;
  let totalResults = 0;
  let totalCallerSummaries = 0;

  for (const interval of intervals) {
    for (const lagMs of lagsMs) {
      for (let overlaySetIndex = 0; overlaySetIndex < overlaySets.length; overlaySetIndex++) {
        const overlaySet = overlaySets[overlaySetIndex];
        if (!overlaySet) continue;

        const overlaySetId = `set-${overlaySetIndex}`;

        // Log progress (ctx.logger is available from WorkflowContextWithPorts)
        console.log(
          `[${sweepId}] Running: interval=${interval}, lagMs=${lagMs}, overlaySet=${overlaySetId} (${overlaySet.length} overlays)`
        );

        // Build request
        const request: EvaluateCallsRequest = {
          calls,
          align: {
            lagMs,
            entryRule: ((args as any)['entry-rule'] || (args as any).entryRule || 'next_candle_open') as 'next_candle_open' | 'next_candle_close' | 'call_time_close',
            timeframeMs: ((args as any)['timeframe-ms'] || (args as any).timeframeMs || 24 * 60 * 60 * 1000) as number,
            interval: interval as '1s' | '1m' | '5m' | '1h',
          },
          backtest: {
            fee: {
              takerFeeBps: ((args as any)['taker-fee-bps'] || (args as any).takerFeeBps || 30) as number,
              slippageBps: ((args as any)['slippage-bps'] || (args as any).slippageBps || 10) as number,
            },
            overlays: overlaySet,
            position: {
              notionalUsd: ((args as any)['notional-usd'] || (args as any).notionalUsd || 1000) as number,
            },
          },
        };

        // Run evaluation
        const result = await evaluateCallsWorkflow(request, ctx);

        // Convert results to rows
        for (let overlayIndex = 0; overlayIndex < overlaySet.length; overlayIndex++) {
          const overlay = overlaySet[overlayIndex];
          if (!overlay) continue;

          const overlayResults = result.results.filter(
            (r: CallBacktestResult) => JSON.stringify(r.overlay) === JSON.stringify(overlay)
          );

          for (const overlayResult of overlayResults) {
            const perCallRow = resultToPerCallRow(
              overlayResult,
              sweepId,
              lagMs,
              interval,
              overlaySetId,
              overlayIndex
            );
            allPerCallRows.push(perCallRow);
            totalResults++;
          }
        }

        // Convert summaries to rows
        for (const summary of result.summaryByCaller) {
          const perCallerRow = summaryToPerCallerRow(summary, sweepId, lagMs, interval, overlaySetId);
          allPerCallerRows.push(perCallerRow);
          totalCallerSummaries++;
        }

        totalRuns++;
      }
    }
  }

  // Write per_call.jsonl (append each row)
  const perCallLines = allPerCallRows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(perCallPath, perCallLines + '\n', 'utf-8');

  // Write per_caller.jsonl
  const perCallerLines = allPerCallerRows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(perCallerPath, perCallerLines + '\n', 'utf-8');

  // Aggregate and write matrix.json
  const matrix = aggregateMatrix(allPerCallRows, allPerCallerRows);
  writeFileSync(matrixPath, JSON.stringify(matrix, null, 2), 'utf-8');

  // Write run.meta.json
  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt).as('milliseconds');

  const metadata: RunMetadata = {
    sweepId,
    startedAtISO,
    completedAtISO,
    durationMs,
    gitSha,
    configHash,
    config: {
      callCount: calls.length,
      intervals,
      lagsMs,
      overlaySetCount: overlaySets.length,
      overlaySetIds: overlaySets.map((_, i) => `set-${i}`),
    },
    counts: {
      totalRuns,
      totalResults,
      totalCallerSummaries,
    },
  };

  writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');

  console.log(
    `[${sweepId}] Sweep completed: ${totalRuns} runs, ${totalResults} results, ${totalCallerSummaries} caller summaries in ${durationMs.toFixed(0)}ms`
  );
  console.log(`Output directory: ${args.out}`);

  return {
    sweepId,
    outputDir: args.out,
    totalRuns,
    totalResults,
    totalCallerSummaries,
    durationMs,
  };
}

