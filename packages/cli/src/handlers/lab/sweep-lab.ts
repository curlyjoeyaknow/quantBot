/**
 * Sweep Lab Handler
 *
 * Runs lab overlay backtesting across a grid of parameters:
 * - Multiple overlay sets
 * - Multiple intervals (optional)
 * - Multiple lags (optional)
 *
 * Queries calls directly from DuckDB (unlike calls sweep which requires a calls file).
 *
 * Uses standard patterns:
 * - Config Loader: Load config from YAML/JSON, merge CLI overrides
 * - Results Writer: Pre-create files, write JSONL incrementally, write meta
 * - Scenario Generator: Deterministic IDs, stable ordering, resume support
 *
 * Writes deterministic outputs:
 * - per_call.jsonl (one row per call × overlay × lag × interval)
 * - per_overlay.jsonl (aggregated by overlay set)
 * - matrix.json (aggregated by lag × interval × overlaySet)
 * - errors.jsonl (all errors for debugging)
 * - run.meta.json (metadata: git sha, config hash, timestamps, completed scenario IDs)
 * - config.json (copy of input config for provenance)
 */

import { readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { DateTime } from 'luxon';
import { cpus } from 'os';
import type { CommandContext } from '../../core/command-context.js';
import type { LabSweepArgs } from '../../command-defs/lab.js';
import { labSweepSchema } from '../../command-defs/lab.js';
import { runLabHandler, type LabRunResult } from './run-lab.js';
import { loadOverlaySetsFromFile, type OverlaySet } from '../../commands/calls/_overlays.js';
import { loadConfig } from '../../core/config-loader.js';
import { ResultsWriter } from '../../core/results-writer.js';
import { loadCompletedIds } from '../../core/scenario-generator.js';
import { join } from 'path';
import { ValidationError, ConfigurationError } from '@quantbot/infra/utils';
import type { ExitOverlay } from '@quantbot/backtest';
import { DuckDBClient } from '@quantbot/storage';
import type { CallSignal } from '@quantbot/core';
import { evaluateCallsWorkflow, createProductionContextWithPorts } from '@quantbot/workflows';

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
  callId: string;
  mint: string;
  createdAtISO: string;

  // Result
  overlay: ExitOverlay;
  ok: boolean;
  netReturnPct?: number;
  grossReturnPct?: number;
  exitReason?: string;
  errorCode?: string;
  errorMessage?: string;
};

/**
 * Per-overlay JSONL row (aggregated by overlay set)
 */
type PerOverlayRow = {
  sweepId: string;
  scenarioId: string;
  lagMs: number;
  interval: string;
  overlaySetId: string;
  overlay: string; // JSON string of overlay
  calls: number;
  callsSucceeded: number;
  callsFailed: number;
  medianNetReturnPct: number;
  winRate: number;
  avgNetReturnPct?: number;
  minNetReturnPct?: number;
  maxNetReturnPct?: number;
};

/**
 * Scenario definition
 */
type Scenario = {
  scenarioId: string;
  lagMs: number;
  interval: string;
  overlaySet: OverlaySet;
};

/**
 * Generate scenarios from sweep parameters
 */
function generateLabScenarios(
  overlaySets: OverlaySet[],
  intervals: string[],
  lagsMs: number[]
): Scenario[] {
  const scenarios: Scenario[] = [];

  for (const overlaySet of overlaySets) {
    for (const interval of intervals) {
      for (const lagMs of lagsMs) {
        const scenarioId = `lag=${lagMs}_interval=${interval}_overlaySet=${overlaySet.id}`;
        scenarios.push({
          scenarioId,
          lagMs,
          interval,
          overlaySet,
        });
      }
    }
  }

  return scenarios;
}

/**
 * Filter out completed scenarios (local version for lab sweep Scenario type)
 */
function filterCompletedScenarios(scenarios: Scenario[], completedIds: string[]): Scenario[] {
  const completedSet = new Set(completedIds);
  return scenarios.filter((scenario) => !completedSet.has(scenario.scenarioId));
}

/**
 * Convert LabRunResult to PerCallRow array
 */
function resultToPerCallRows(
  result: LabRunResult,
  sweepId: string,
  scenarioId: string,
  lagMs: number,
  interval: string,
  overlaySetId: string
): PerCallRow[] {
  return result.results.map((r, overlayIndex) => ({
    sweepId,
    scenarioId,
    lagMs,
    interval,
    overlaySetId,
    overlayIndex,
    callId: r.callId,
    mint: r.mint,
    createdAtISO: r.createdAtISO,
    overlay: JSON.parse(r.overlay) as ExitOverlay,
    ok: r.ok,
    netReturnPct: r.netReturnPct,
    grossReturnPct: r.grossReturnPct,
    exitReason: r.exitReason,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
  }));
}

/**
 * Aggregate per-call rows into per-overlay rows
 */
function aggregatePerOverlay(perCallRows: PerCallRow[]): PerOverlayRow[] {
  const byOverlay = new Map<string, PerCallRow[]>();

  for (const row of perCallRows) {
    const key = `${row.scenarioId}_${row.overlayIndex}`;
    if (!byOverlay.has(key)) {
      byOverlay.set(key, []);
    }
    byOverlay.get(key)!.push(row);
  }

  const perOverlayRows: PerOverlayRow[] = [];

  for (const [key, rows] of byOverlay.entries()) {
    const firstRow = rows[0];
    const successfulRows = rows.filter((r) => r.ok && r.netReturnPct !== undefined);
    const netReturns = successfulRows.map((r) => r.netReturnPct!).sort((a, b) => a - b);
    const wins = successfulRows.filter((r) => (r.netReturnPct || 0) > 0).length;

    perOverlayRows.push({
      sweepId: firstRow.sweepId,
      scenarioId: firstRow.scenarioId,
      lagMs: firstRow.lagMs,
      interval: firstRow.interval,
      overlaySetId: firstRow.overlaySetId,
      overlay:
        firstRow.overlay.kind === 'combo'
          ? JSON.stringify(firstRow.overlay)
          : firstRow.overlay.kind,
      calls: rows.length,
      callsSucceeded: successfulRows.length,
      callsFailed: rows.length - successfulRows.length,
      medianNetReturnPct: netReturns.length > 0 ? netReturns[Math.floor(netReturns.length / 2)] : 0,
      winRate: successfulRows.length > 0 ? wins / successfulRows.length : 0,
      avgNetReturnPct:
        netReturns.length > 0
          ? netReturns.reduce((a, b) => a + b, 0) / netReturns.length
          : undefined,
      minNetReturnPct: netReturns.length > 0 ? netReturns[0] : undefined,
      maxNetReturnPct: netReturns.length > 0 ? netReturns[netReturns.length - 1] : undefined,
    });
  }

  return perOverlayRows;
}

export async function sweepLabHandler(args: LabSweepArgs, ctx: CommandContext) {
  // 1. Load config (if provided) or use CLI args
  let config: LabSweepArgs;
  if (args.config) {
    const cliOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (key === 'config') continue;
      if (
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0)
      ) {
        cliOverrides[key] = value;
      }
    }
    config = await loadConfig(args.config, labSweepSchema, cliOverrides);
  } else {
    config = args;
  }

  // 2. Validate required fields
  const overlaysFile = config.overlaysFile || config.overlaySetsFile;
  if (!overlaysFile) {
    throw new ValidationError(
      'overlaysFile is required (from config or --overlays-file/--overlay-sets-file)',
      { config }
    );
  }
  if (!config.out) {
    throw new ValidationError('out is required (from config or --out)', { config });
  }

  // 3. Load overlay sets
  let overlaySets: OverlaySet[];
  try {
    overlaySets = loadOverlaySetsFromFile(overlaysFile);
    if (overlaySets.length === 0) {
      throw new ValidationError('Overlay sets file must contain at least one overlay set', {
        overlayFile: overlaysFile,
      });
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ConfigurationError(`Failed to load overlays from ${overlaysFile}`, 'overlayFile', {
      overlayFile: overlaysFile,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 4. Set defaults for intervals and lags if not provided
  const intervals = config.intervals || ['5m'];
  const lagsMs = config.lagsMs || [10000];

  // 5. Generate scenarios
  const allScenarios = generateLabScenarios(overlaySets, intervals, lagsMs);

  // 6. Setup results writer
  const writer = new ResultsWriter();

  // 7. Resume support
  let scenariosToRun = allScenarios;
  if (config.resume) {
    const metaPath = join(config.out, 'run.meta.json');
    const completedIds = loadCompletedIds(metaPath);
    if (completedIds.length > 0) {
      console.log(`[Sweep] Resuming: ${completedIds.length} scenarios already completed`);
      scenariosToRun = filterCompletedScenarios(allScenarios, completedIds);
    }
  }

  // 8. Initialize results files
  await writer.initialize(config.out, {
    ...config,
    overlaySetsCount: overlaySets.length,
    intervalsCount: intervals.length,
    lagsMsCount: lagsMs.length,
    totalScenarios: allScenarios.length,
  });

  const paths = writer.getPaths()!;
  const sweepId = paths.outDir.split('/').pop() || 'unknown';

  // 9. Determine processing mode: Parquet (parallel) or DuckDB (sequential)
  const useParquet = !!config.parquetDir;
  const workers = config.workers || cpus().length;

  const errors: Array<{ scenarioId: string; error: string }> = [];
  const perCallRows: PerCallRow[] = [];

  if (useParquet) {
    // Parallel processing from Parquet files
    await processParquetSweep(
      config,
      allScenarios,
      scenariosToRun,
      ctx,
      writer,
      sweepId,
      errors,
      perCallRows,
      workers
    );
  } else {
    // Sequential processing from DuckDB (original behavior)
    for (let i = 0; i < scenariosToRun.length; i++) {
      const scenario = scenariosToRun[i];
      const progress = `[${i + 1}/${scenariosToRun.length}]`;

      try {
        // Build lab run args for this scenario
        const labRunArgs = {
          from: config.from,
          to: config.to,
          caller: config.caller,
          mint: config.mint,
          limit: config.limit,
          overlays: scenario.overlaySet.overlays,
          lagMs: scenario.lagMs,
          entryRule: config.entryRule,
          timeframeMs: config.timeframeMs,
          interval: scenario.interval as '1m' | '5m' | '15m' | '1h',
          takerFeeBps: config.takerFeeBps,
          slippageBps: config.slippageBps,
          notionalUsd: config.notionalUsd,
          format: 'json' as const,
        };

        // Run lab handler
        const result = await runLabHandler(labRunArgs, ctx);

        // Convert results to per-call rows
        const rows = resultToPerCallRows(
          result,
          sweepId,
          scenario.scenarioId,
          scenario.lagMs,
          scenario.interval,
          scenario.overlaySet.id
        );
        perCallRows.push(...rows);

        // Write per-call rows incrementally
        for (const row of rows) {
          await writer.writePerCall(row);
        }

        // Mark scenario as completed
        writer.addCompletedScenario(scenario.scenarioId);

        console.log(
          `${progress} Completed ${scenario.scenarioId}: ${result.callsSucceeded}/${result.callsSimulated} calls succeeded`
        );
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ scenarioId: scenario.scenarioId, error: errorMsg });
        await writer.writeError({ scenarioId: scenario.scenarioId, error: errorMsg });
        console.error(`${progress} Failed ${scenario.scenarioId}: ${errorMsg}`);
      }
    }
  }

  // 10. Aggregate and write per-overlay rows
  const perOverlayRows = aggregatePerOverlay(perCallRows);
  for (const row of perOverlayRows) {
    await writer.writePerCaller(row);
  }

  // 11. Build matrix (aggregated by lag × interval × overlaySet)
  const matrix: Record<string, unknown> = {};
  for (const row of perOverlayRows) {
    const key = JSON.stringify({
      lagMs: row.lagMs,
      interval: row.interval,
      overlaySetId: row.overlaySetId,
    });
    if (!matrix[key]) {
      matrix[key] = {
        lagMs: row.lagMs,
        interval: row.interval,
        overlaySetId: row.overlaySetId,
        calls: 0,
        callsSucceeded: 0,
        callsFailed: 0,
        medianNetReturnPct: 0,
        winRate: 0,
        avgNetReturnPct: 0,
        minNetReturnPct: 0,
        maxNetReturnPct: 0,
        bestOverlay: undefined,
      };
    }
    const matrixRow = matrix[key] as {
      calls: number;
      callsSucceeded: number;
      callsFailed: number;
      medianNetReturnPct: number;
      winRate: number;
      avgNetReturnPct: number;
      minNetReturnPct: number;
      maxNetReturnPct: number;
      bestOverlay?: string;
    };
    matrixRow.calls += row.calls;
    matrixRow.callsSucceeded += row.callsSucceeded;
    matrixRow.callsFailed += row.callsFailed;
    // Keep best overlay (highest median return)
    if (
      !matrixRow.bestOverlay ||
      row.medianNetReturnPct > (matrixRow as { medianNetReturnPct: number }).medianNetReturnPct
    ) {
      matrixRow.bestOverlay = row.overlay;
      (matrixRow as { medianNetReturnPct: number }).medianNetReturnPct = row.medianNetReturnPct;
      matrixRow.winRate = row.winRate;
      matrixRow.avgNetReturnPct = row.avgNetReturnPct || 0;
      matrixRow.minNetReturnPct = row.minNetReturnPct || 0;
      matrixRow.maxNetReturnPct = row.maxNetReturnPct || 0;
    }
  }

  // 12. Write matrix
  await writer.writeMatrix(matrix);

  // 13. Finalize results
  const finalResult = await writer.finalize({
    counts: {
      totalRuns: scenariosToRun.length,
    },
    diagnostics: {
      completedScenarios: scenariosToRun.length - errors.length,
      failedScenarios: errors.length,
      totalCalls: perCallRows.length,
    },
  });

  return {
    success: true,
    sweepId: finalResult.paths?.outDir.split('/').pop() || 'unknown',
    totalScenarios: allScenarios.length,
    completedScenarios: scenariosToRun.length - errors.length,
    failedScenarios: errors.length,
    outputDir: config.out,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Process sweep from Parquet files with parallel processing by caller
 */
async function processParquetSweep(
  config: LabSweepArgs,
  allScenarios: Scenario[],
  scenariosToRun: Scenario[],
  ctx: CommandContext,
  writer: ResultsWriter,
  sweepId: string,
  errors: Array<{ scenarioId: string; error: string }>,
  perCallRows: PerCallRow[],
  workers: number
): Promise<void> {
  // Load manifest
  const manifestPath = join(config.parquetDir!, 'manifest.json');
  const manifestContent = await readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestContent) as {
    callers: Array<{ name: string; file: string; count: number }>;
  };

  // Process callers in parallel batches
  const callerBatches: Array<typeof manifest.callers> = [];
  for (let i = 0; i < manifest.callers.length; i += workers) {
    callerBatches.push(manifest.callers.slice(i, i + workers));
  }

  for (const batch of callerBatches) {
    await Promise.all(
      batch.map(async (callerInfo) => {
        const parquetPath = join(config.parquetDir!, callerInfo.file);

        // Load calls from Parquet
        const duckdbClient = new DuckDBClient(':memory:');
        const result = await duckdbClient.query(`
          SELECT 
            mint,
            alert_ts_ms,
            CAST(alert_ts_ms AS TIMESTAMP) AS alert_timestamp,
            caller_name,
            price_usd
          FROM read_parquet('${parquetPath.replace(/'/g, "''")}')
        `);

        if (result.error || !result.rows) {
          console.error(`[Sweep] Failed to load calls from ${callerInfo.file}: ${result.error}`);
          return;
        }

        // Convert to CallSignal format
        const calls: CallSignal[] = result.rows.map((row: unknown[]) => {
          const [mint, alertTsMs, alertTimestamp, callerName, priceUsd] = row;
          // alertTsMs is already in milliseconds from Parquet
          const tsMs = typeof alertTsMs === 'number' ? alertTsMs : Number(alertTsMs);

          return {
            kind: 'token_call',
            tsMs,
            token: {
              address: String(mint),
              chain: 'sol',
            },
            caller: {
              displayName: String(callerName || 'unknown'),
              fromId: String(callerName || 'unknown')
                .toLowerCase()
                .replace(/\s+/g, '-'),
            },
            source: {
              callerMessageId: 0,
            },
            enrichment: priceUsd
              ? {
                  tsMs,
                  enricher: {
                    displayName: 'Parquet',
                    fromId: 'parquet',
                  },
                  snapshot: {
                    priceUsd: Number(priceUsd),
                  },
                }
              : undefined,
            parse: {
              confidence: 1.0,
              reasons: ['from_parquet'],
            },
          };
        });

        // Process all scenarios for this caller
        for (const scenario of scenariosToRun) {
          const progress = `[caller=${callerInfo.name}]`;

          try {
            // Build lab run args (using calls from Parquet, not DuckDB query)
            const labRunArgs = {
              from: config.from,
              to: config.to,
              caller: callerInfo.name, // Use caller from Parquet
              mint: config.mint,
              limit: calls.length,
              overlays: scenario.overlaySet.overlays,
              lagMs: scenario.lagMs,
              entryRule: config.entryRule,
              timeframeMs: config.timeframeMs,
              interval: scenario.interval as '1m' | '5m' | '15m' | '1h',
              takerFeeBps: config.takerFeeBps,
              slippageBps: config.slippageBps,
              notionalUsd: config.notionalUsd,
              format: 'json' as const,
            };

            // Run evaluation workflow directly with calls from Parquet
            const workflowCtx = await createProductionContextWithPorts();
            const request = {
              calls,
              align: {
                lagMs: scenario.lagMs,
                entryRule: (config.entryRule || 'next_candle_open') as
                  | 'next_candle_open'
                  | 'next_candle_close'
                  | 'call_time_close',
                timeframeMs: config.timeframeMs || 24 * 60 * 60 * 1000,
                interval: scenario.interval as '1m' | '5m' | '15m' | '1h',
              },
              backtest: {
                fee: {
                  takerFeeBps: config.takerFeeBps || 30,
                  slippageBps: config.slippageBps || 10,
                },
                overlays: scenario.overlaySet.overlays,
                position: {
                  notionalUsd: config.notionalUsd || 1000,
                },
              },
            };

            const { evaluateCallsWorkflow } = await import('@quantbot/workflows');
            const workflowResult = await evaluateCallsWorkflow(request, workflowCtx);

            // Convert workflow results to per-call rows
            for (
              let overlayIndex = 0;
              overlayIndex < scenario.overlaySet.overlays.length;
              overlayIndex++
            ) {
              const overlay = scenario.overlaySet.overlays[overlayIndex];
              if (!overlay) continue;

              for (const callResult of workflowResult.results) {
                const perCallRow: PerCallRow = {
                  sweepId,
                  scenarioId: scenario.scenarioId,
                  lagMs: scenario.lagMs,
                  interval: scenario.interval,
                  overlaySetId: scenario.overlaySet.id,
                  overlayIndex,
                  callId: `${callResult.call.tsMs}_${callResult.call.token.address}`,
                  mint: callResult.call.token.address,
                  createdAtISO: DateTime.fromMillis(callResult.call.tsMs).toISO()!,
                  overlay: overlay as ExitOverlay,
                  ok: callResult.diagnostics.tradeable || false,
                  netReturnPct: callResult.pnl?.netReturnPct,
                  grossReturnPct: callResult.pnl?.grossReturnPct,
                  exitReason: callResult.exit?.reason,
                  errorCode: callResult.diagnostics.skippedReason,
                  errorMessage: callResult.diagnostics.skippedReason,
                };
                perCallRows.push(perCallRow);
                await writer.writePerCall(perCallRow);
              }
            }

            // Mark scenario as completed
            writer.addCompletedScenario(scenario.scenarioId);

            console.log(
              `${progress} Completed ${scenario.scenarioId}: ${workflowResult.results.length} calls processed`
            );
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push({ scenarioId: scenario.scenarioId, error: errorMsg });
            await writer.writeError({ scenarioId: scenario.scenarioId, error: errorMsg });
            console.error(`${progress} Failed ${scenario.scenarioId}: ${errorMsg}`);
          }
        }
      })
    );
  }
}
