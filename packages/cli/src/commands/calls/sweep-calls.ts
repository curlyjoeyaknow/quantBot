/**
 * Sweep Calls Handler (Refactored with Patterns)
 *
 * Runs evaluateCallsWorkflow across a grid of parameters:
 * - Multiple intervals (1m, 5m, etc.)
 * - Multiple lags (0ms, 10s, 30s, 60s, etc.)
 * - Multiple overlay sets
 *
 * Uses standard patterns:
 * - Config Loader: Load config from YAML/JSON, merge CLI overrides
 * - Results Writer: Pre-create files, write JSONL incrementally, write meta
 * - Scenario Generator: Deterministic IDs, stable ordering, resume support
 *
 * Writes deterministic outputs:
 * - per_call.jsonl (one row per call × overlay × lag × interval)
 * - per_caller.jsonl (aggregated by caller per configuration)
 * - matrix.json (aggregated by caller × lag × interval × overlaySet)
 * - errors.jsonl (all errors for debugging)
 * - run.meta.json (metadata: git sha, config hash, timestamps, completed scenario IDs)
 * - config.json (copy of input config for provenance)
 */

import { readFileSync } from 'fs';
import type { CommandContext } from '../../core/command-context.js';
import { evaluateCallsWorkflow, createProductionContextWithPorts } from '@quantbot/workflows';
import type { EvaluateCallsRequest, CallerSummary, CallBacktestResult } from '@quantbot/workflows';
import type { CallSignal } from '@quantbot/core';
import type { ExitOverlay } from '@quantbot/simulation';
import type { SweepCallsArgs } from '../../command-defs/calls.js';
import { loadOverlaySetsFromFile, type OverlaySet } from './_overlays.js';
import { sweepCallsSchema } from '../../command-defs/calls.js';
import { loadConfig } from '../../core/config-loader.js';
import { ResultsWriter } from '../../core/results-writer.js';
import {
  generateScenarios,
  filterCompleted,
  loadCompletedIds,
} from '../../core/scenario-generator.js';
import { join } from 'path';

/**
 * Per-call JSONL row (one per call × overlay × lag × interval)
 */
type PerCallRow = {
  // Sweep metadata
  sweepId: string;
  scenarioId: string;
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
  scenarioId: string;
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
 * Convert CallBacktestResult to PerCallRow
 */
function resultToPerCallRow(
  result: CallBacktestResult,
  sweepId: string,
  scenarioId: string,
  lagMs: number,
  interval: string,
  overlaySetId: string,
  overlayIndex: number
): PerCallRow {
  return {
    sweepId,
    scenarioId,
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
  scenarioId: string,
  lagMs: number,
  interval: string,
  overlaySetId: string
): PerCallerRow {
  return {
    sweepId,
    scenarioId,
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
  // 1. Load config (if provided) or use CLI args
  let config: SweepCallsArgs;
  if (args.config) {
    // Load config from file and merge CLI overrides
    const cliOverrides = { ...args };
    delete cliOverrides.config; // Remove config path from overrides
    config = await loadConfig(args.config, sweepCallsSchema, cliOverrides);
  } else {
    config = args;
  }

  // 2. Validate that all required fields are present (after config loading)
  if (!config.callsFile) {
    throw new Error('callsFile is required (from config or --calls-file)');
  }
  if (!config.intervals || config.intervals.length === 0) {
    throw new Error('intervals is required (from config or --intervals)');
  }
  if (!config.lagsMs || config.lagsMs.length === 0) {
    throw new Error('lagsMs is required (from config or --lags-ms)');
  }
  if (!config.out) {
    throw new Error('out is required (from config or --out)');
  }

  // 3. Load calls from file
  let calls: CallSignal[];
  try {
    const fileContent = readFileSync(config.callsFile, 'utf-8');
    const parsed = JSON.parse(fileContent);
    if (!Array.isArray(parsed)) {
      throw new Error('Calls file must contain a JSON array of CallSignal objects');
    }
    calls = parsed as CallSignal[];
  } catch (error) {
    throw new Error(
      `Failed to load calls from ${config.callsFile}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 4. Load overlay sets
  const overlayFile = config.overlaysFile || config.overlaySetsFile;
  if (!overlayFile) {
    throw new Error('Either overlaysFile or overlaySetsFile is required');
  }

  let overlaySets: OverlaySet[];
  try {
    overlaySets = loadOverlaySetsFromFile(overlayFile);
    if (overlaySets.length === 0) {
      throw new Error('Overlay sets file must contain at least one overlay set');
    }
  } catch (error) {
    throw new Error(
      `Failed to load overlays from ${overlayFile}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // 5. Generate scenarios (deterministic)
  let scenarios = generateScenarios(config.intervals, config.lagsMs, overlaySets);

  // 6. Resume support (if requested)
  if (config.resume) {
    const metaPath = join(config.out, 'run.meta.json');
    const completedIds = loadCompletedIds(metaPath);
    if (completedIds.length > 0) {
      console.log(`[Sweep] Resuming: ${completedIds.length} scenarios already completed`);
      scenarios = filterCompleted(scenarios, completedIds);
    }
  }

  // 7. Initialize results writer
  const writer = new ResultsWriter();
  await writer.initialize(config.out, config as unknown as Record<string, unknown>);
  const paths = writer.getPaths()!;

  // 8. Initialize diagnostic counters
  const diagnostics = {
    fetchedCandlesCount: 0,
    skippedNoCandles: 0,
    skippedUnknownChain: 0,
    skippedEntryOutOfWindow: 0,
    skippedOther: 0,
    sweepErrors: 0,
  };

  // 9. Create production context (reuse across runs)
  const ctx = await createProductionContextWithPorts();

  // 10. Run scenarios (sequential, deterministic)
  const allPerCallRows: PerCallRow[] = [];
  const allPerCallerRows: PerCallerRow[] = [];

  for (const scenario of scenarios) {
    const { id: scenarioId, params } = scenario;
    const { interval, lagMs, overlaySetId, overlaySetIndex } = params;
    const overlaySet = overlaySets[overlaySetIndex];
    if (!overlaySet) continue;

    const configKey = `interval=${interval},lagMs=${lagMs},overlaySet=${overlaySetId}`;
    console.log(
      `[Sweep] Running scenario ${scenarioId}: ${configKey} (${overlaySet.overlays.length} overlays)`
    );

    try {
      // Build request
      const request: EvaluateCallsRequest = {
        calls,
        align: {
          lagMs,
          entryRule: (config.entryRule || 'next_candle_open') as
            | 'next_candle_open'
            | 'next_candle_close'
            | 'call_time_close',
          timeframeMs: (config.timeframeMs || 24 * 60 * 60 * 1000) as number,
          interval: interval as '1s' | '1m' | '5m' | '1h',
        },
        backtest: {
          fee: {
            takerFeeBps: (config.takerFeeBps || 30) as number,
            slippageBps: (config.slippageBps || 10) as number,
          },
          overlays: overlaySet.overlays as ExitOverlay[],
          position: {
            notionalUsd: (config.notionalUsd || 1000) as number,
          },
        },
      };

      // Run evaluation
      const result = await evaluateCallsWorkflow(request, ctx);

      // Update diagnostics (infer from results)
      for (const r of result.results) {
        if (r.diagnostics.candlesUsed > 0) {
          diagnostics.fetchedCandlesCount += r.diagnostics.candlesUsed;
        }
        if (!r.diagnostics.tradeable) {
          const reason = r.diagnostics.skippedReason || '';
          if (reason.includes('candle') || reason.includes('no data')) {
            diagnostics.skippedNoCandles++;
          } else if (reason.includes('chain') || reason.includes('unknown')) {
            diagnostics.skippedUnknownChain++;
          } else if (reason.includes('window') || reason.includes('entry')) {
            diagnostics.skippedEntryOutOfWindow++;
          } else {
            diagnostics.skippedOther++;
          }
        }
      }

      // Write per-call rows
      for (let overlayIndex = 0; overlayIndex < overlaySet.overlays.length; overlayIndex++) {
        const overlay = overlaySet.overlays[overlayIndex];
        if (!overlay) continue;

        const overlayResults = result.results.filter(
          (r: CallBacktestResult) => JSON.stringify(r.overlay) === JSON.stringify(overlay)
        );

        for (const overlayResult of overlayResults) {
          const perCallRow = resultToPerCallRow(
            overlayResult,
            paths.outDir.split('/').pop()!, // Extract sweepId from path
            scenarioId,
            lagMs,
            interval,
            overlaySetId,
            overlayIndex
          );
          await writer.writePerCall(perCallRow);
          allPerCallRows.push(perCallRow);
        }
      }

      // Write per-caller rows
      for (const summary of result.summaryByCaller) {
        const perCallerRow = summaryToPerCallerRow(
          summary,
          paths.outDir.split('/').pop()!,
          scenarioId,
          lagMs,
          interval,
          overlaySetId
        );
        await writer.writePerCaller(perCallerRow);
        allPerCallerRows.push(perCallerRow);
      }

      // Mark scenario as completed (for resume support)
      writer.addCompletedScenario(scenarioId);
    } catch (error) {
      // Write error and continue to next scenario
      diagnostics.sweepErrors++;
      await writer.writeError({
        kind: 'scenario_error',
        scenarioId,
        configKey,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(
        `[Sweep] Error in scenario ${scenarioId}:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // 11. Aggregate and write matrix
  const matrix = aggregateMatrix(allPerCallRows, allPerCallerRows);
  await writer.writeMatrix(matrix);

  // 12. Finalize and write final run.meta.json
  const result = await writer.finalize({
    counts: { totalRuns: scenarios.length },
    diagnostics,
  });

  console.log(
    `[Sweep] Completed: ${scenarios.length} scenarios, ${result.counts.perCallRows} results, ${result.counts.perCallerRows} caller summaries`
  );
  console.log(`Output directory: ${config.out}`);
  console.log(`Diagnostics:`, diagnostics);

  return {
    outputDir: config.out,
    totalScenarios: scenarios.length,
    totalResults: result.counts.perCallRows,
    totalCallerSummaries: result.counts.perCallerRows,
    diagnostics,
  };
}
