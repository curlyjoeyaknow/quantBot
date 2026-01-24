/**
 * Phase 1: Lab Sweep Discovery
 *
 * Uses lab sweeps to quickly identify promising parameter ranges per caller.
 * Calls lab sweep handler programmatically and analyzes results.
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Phase1Config, Phase1Result, OptimalRange } from './types.js';
import { logger } from '@quantbot/utils';
import { DuckDBClient } from '@quantbot/storage';
import { writeFile } from 'fs/promises';
import { getPhaseArtifactPath } from './lake-directory.js';
import type { WorkflowContextWithPorts } from '../../calls/evaluate.js';
import { evaluateCallsWorkflow, type EvaluateCallsRequest } from '../../calls/evaluate.js';
import { createProductionContextWithPorts } from '../../context/createProductionContext.js';
import type { CallSignal } from '@quantbot/core';
import { DuckDBClient as StorageDuckDBClient } from '@quantbot/storage';

/**
 * Generate overlay sets from TP/SL parameter grid
 */
function generateOverlaySets(tpMults: number[], slMults: number[]): Array<{
  id: string;
  overlays: Array<{ kind: string; takePct?: number; stopPct?: number }>;
}> {
  const sets: Array<{
    id: string;
    overlays: Array<{ kind: string; takePct?: number; stopPct?: number }>;
  }> = [];

  for (const tpMult of tpMults) {
    for (const slMult of slMults) {
      sets.push({
        id: `tp${tpMult}_sl${slMult}`,
        overlays: [
          { kind: 'take_profit', takePct: (tpMult - 1) * 100 },
          { kind: 'stop_loss', stopPct: (1 - slMult) * 100 },
        ],
      });
    }
  }

  return sets;
}

/**
 * Analyze lab sweep results per caller and extract optimal ranges
 */
async function analyzeLabSweepResults(
  sweepOutputDir: string,
  minCallsPerCaller?: number
): Promise<Phase1Result> {
  // Read per_overlay.jsonl results
  const perOverlayPath = join(sweepOutputDir, 'per_overlay.jsonl');
  const perOverlayContent = await readFile(perOverlayPath, 'utf-8');
  const perOverlayRows = perOverlayContent
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  // Group by caller (if caller info is available)
  // For now, we'll analyze overall results and extract optimal ranges
  // TODO: Parse caller from results if available

  // Analyze results to find optimal parameter combinations
  const optimalRanges: OptimalRange[] = [];
  const callerGroups = new Map<string, typeof perOverlayRows>();

  // Group by caller if available, otherwise treat as single group
  for (const row of perOverlayRows) {
    const caller = row.caller || 'all';
    if (!callerGroups.has(caller)) {
      callerGroups.set(caller, []);
    }
    callerGroups.get(caller)!.push(row);
  }

  // Extract optimal ranges per caller
  for (const [caller, rows] of callerGroups.entries()) {
    if (minCallsPerCaller && rows.length < minCallsPerCaller) {
      continue;
    }

    // Sort by win rate and median return
    const sorted = rows.sort((a, b) => {
      const scoreA = (a.winRate || 0) * 0.5 + (a.medianNetReturnPct || 0) * 0.5;
      const scoreB = (b.winRate || 0) * 0.5 + (b.medianNetReturnPct || 0) * 0.5;
      return scoreB - scoreA;
    });

    // Take top 20% of results
    const topResults = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));

    // Extract TP/SL ranges from overlay set IDs
    const tpMults: number[] = [];
    const slMults: number[] = [];

    for (const result of topResults) {
      const overlaySetId = result.overlaySetId || '';
      const tpMatch = overlaySetId.match(/tp([\d.]+)/);
      const slMatch = overlaySetId.match(/sl([\d.]+)/);

      if (tpMatch) {
        tpMults.push(parseFloat(tpMatch[1]));
      }
      if (slMatch) {
        slMults.push(parseFloat(slMatch[1]));
      }
    }

    if (tpMults.length > 0 && slMults.length > 0) {
      optimalRanges.push({
        caller,
        tpMult: {
          min: Math.min(...tpMults),
          max: Math.max(...tpMults),
          optimal: tpMults[Math.floor(tpMults.length / 2)],
        },
        slMult: {
          min: Math.min(...slMults),
          max: Math.max(...slMults),
          optimal: slMults[Math.floor(slMults.length / 2)],
        },
        metrics: {
          winRate: topResults[0]?.winRate || 0,
          medianReturnPct: topResults[0]?.medianNetReturnPct || 0,
          hit2xPct: 0, // TODO: Extract from results if available
          callsCount: rows.reduce((sum, r) => sum + (r.calls || 0), 0),
        },
      });
    }
  }

  const excludedCallers: string[] = [];
  for (const [caller, rows] of callerGroups.entries()) {
    if (minCallsPerCaller && rows.length < minCallsPerCaller) {
      excludedCallers.push(caller);
    }
  }

  return {
    optimalRanges,
    summary: {
      totalCallers: callerGroups.size,
      callersWithRanges: optimalRanges.length,
      excludedCallers,
    },
  };
}

/**
 * Load calls from DuckDB
 */
async function loadCallsFromDuckDB(
  duckdbPath: string,
  dateFrom: string,
  dateTo: string,
  caller?: string
): Promise<CallSignal[]> {
  const db = new StorageDuckDBClient(duckdbPath);
  
  let query = `
    SELECT 
      call_id,
      caller,
      mint,
      ts_ms,
      chain
    FROM alerts
    WHERE ts_ms >= ? AND ts_ms < ?
  `;
  
  const params: unknown[] = [
    new Date(dateFrom).getTime(),
    new Date(dateTo).getTime(),
  ];
  
  if (caller) {
    query += ' AND caller = ?';
    params.push(caller);
  }
  
  query += ' ORDER BY ts_ms';
  
  const rows = await db.query(query, params);
  await db.close();
  
  return rows.map((row) => ({
    callId: row.call_id as string,
    caller: row.caller as string,
    mint: row.mint as string,
    timestampMs: row.ts_ms as number,
    chain: (row.chain as string) || 'solana',
  }));
}

/**
 * Run Phase 1: Lab Sweep Discovery
 */
export async function runPhase1LabSweepDiscovery(
  config: Phase1Config,
  dateFrom: string,
  dateTo: string,
  callers: string[] | undefined,
  runDir: string,
  duckdbPath: string
): Promise<Phase1Result> {
  logger.info('Starting Phase 1: Lab Sweep Discovery', {
    dateFrom,
    dateTo,
    callers: callers?.length || 'all',
  });

  // Generate overlay sets from parameter grid
  const overlaySets = generateOverlaySets(config.tpMults, config.slMults);

  // Write overlay sets to inputs directory
  const overlaysFile = join(runDir, 'inputs', 'phase1-overlays.json');
  await writeFile(overlaysFile, JSON.stringify(overlaySets, null, 2), 'utf-8');

  // Create workflow context
  const workflowCtx = await createProductionContextWithPorts();

  // Load calls from DuckDB
  const allCalls = await loadCallsFromDuckDB(duckdbPath, dateFrom, dateTo);
  
  // Group calls by caller
  const callsByCaller = new Map<string, CallSignal[]>();
  for (const call of allCalls) {
    if (!callsByCaller.has(call.caller)) {
      callsByCaller.set(call.caller, []);
    }
    callsByCaller.get(call.caller)!.push(call);
  }

  // Determine which callers to process
  const callersToProcess = callers || Array.from(callsByCaller.keys());
  const allResults: Phase1Result['optimalRanges'] = [];

  // Run sweeps for each caller
  for (const caller of callersToProcess) {
    const calls = callsByCaller.get(caller) || [];
    
    if (calls.length === 0) {
      logger.warn('No calls found for caller', { caller });
      continue;
    }

    if (config.minCallsPerCaller && calls.length < config.minCallsPerCaller) {
      logger.info('Skipping caller - insufficient calls', {
        caller,
        callsCount: calls.length,
        minRequired: config.minCallsPerCaller,
      });
      continue;
    }

    logger.info('Running lab sweep for caller', { caller, callsCount: calls.length });

    const callerResults: Array<{
      tpMult: number;
      slMult: number;
      interval: string;
      lagMs: number;
      winRate: number;
      medianReturnPct: number;
      callsCount: number;
    }> = [];

    // Run all parameter combinations
    for (const overlaySet of overlaySets) {
      for (const interval of config.intervals) {
        for (const lagMs of config.lagsMs) {
          try {
            const request: EvaluateCallsRequest = {
              calls,
              align: {
                lagMs,
                entryRule: 'next_candle_open',
                timeframeMs: 24 * 60 * 60 * 1000,
                interval: interval as '1m' | '5m' | '15m' | '1h',
              },
              backtest: {
                fee: {
                  takerFeeBps: 30,
                  slippageBps: 10,
                },
                overlays: overlaySet.overlays as Array<{
                  kind: string;
                  takePct?: number;
                  stopPct?: number;
                }>,
                position: {
                  notionalUsd: 1000,
                },
              },
            };

            const result = await evaluateCallsWorkflow(request, workflowCtx);

            // Extract metrics from result
            const successfulResults = result.results.filter((r) => r.tradeable && r.trade);
            if (successfulResults.length === 0) continue;

            const returns = successfulResults.map((r) => r.trade!.realizedReturnBps / 100);
            const wins = successfulResults.filter((r) => (r.trade!.realizedReturnBps || 0) > 0).length;
            const winRate = wins / successfulResults.length;
            const sortedReturns = [...returns].sort((a, b) => a - b);
            const medianReturnPct = sortedReturns[Math.floor(sortedReturns.length / 2)] || 0;

            // Extract TP/SL from overlay set ID
            const tpMatch = overlaySet.id.match(/tp([\d.]+)/);
            const slMatch = overlaySet.id.match(/sl([\d.]+)/);
            const tpMult = tpMatch ? parseFloat(tpMatch[1]) : 0;
            const slMult = slMatch ? parseFloat(slMatch[1]) : 0;

            callerResults.push({
              tpMult,
              slMult,
              interval,
              lagMs,
              winRate,
              medianReturnPct,
              callsCount: successfulResults.length,
            });
          } catch (error) {
            logger.error('Lab sweep scenario failed', error as Error, {
              caller,
              overlaySet: overlaySet.id,
              interval,
              lagMs,
            });
            // Continue with next scenario
          }
        }
      }
    }

    // Analyze caller results to find optimal ranges
    if (callerResults.length > 0) {
      // Sort by score (win rate * median return)
      const sorted = callerResults.sort((a, b) => {
        const scoreA = a.winRate * 0.5 + a.medianReturnPct * 0.5;
        const scoreB = b.winRate * 0.5 + b.medianReturnPct * 0.5;
        return scoreB - scoreA;
      });

      // Take top 20%
      const topResults = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.2)));

      const tpMults = topResults.map((r) => r.tpMult);
      const slMults = topResults.map((r) => r.slMult);

      if (tpMults.length > 0 && slMults.length > 0) {
        allResults.push({
          caller,
          tpMult: {
            min: Math.min(...tpMults),
            max: Math.max(...tpMults),
            optimal: tpMults[Math.floor(tpMults.length / 2)],
          },
          slMult: {
            min: Math.min(...slMults),
            max: Math.max(...slMults),
            optimal: slMults[Math.floor(slMults.length / 2)],
          },
          metrics: {
            winRate: topResults[0]?.winRate || 0,
            medianReturnPct: topResults[0]?.medianReturnPct || 0,
            hit2xPct: 0, // TODO: Extract from results if available
            callsCount: topResults[0]?.callsCount || 0,
          },
        });
      }
    }
  }

  // Aggregate results
  const phase1Result: Phase1Result = {
    optimalRanges: allResults,
    summary: {
      totalCallers: callersToProcess.length,
      callersWithRanges: allResults.length,
      excludedCallers: callersToProcess.filter(
        (c) => !allResults.some((r) => r.caller === c)
      ),
    },
  };

  // Write results to Parquet
  const resultsParquetPath = getPhaseArtifactPath(runDir, 'phase1', 'lab-sweep-results.parquet');
  await writeResultsToParquet(phase1Result, resultsParquetPath);

  // Write summary JSON
  const summaryPath = getPhaseArtifactPath(runDir, 'phase1', 'summary.json');
  await writeFile(summaryPath, JSON.stringify(phase1Result.summary, null, 2), 'utf-8');

  // Write optimal ranges JSON
  const rangesPath = getPhaseArtifactPath(runDir, 'phase1', 'optimal-ranges.json');
  await writeFile(rangesPath, JSON.stringify(phase1Result.optimalRanges, null, 2), 'utf-8');

  logger.info('Phase 1 completed', {
    callersWithRanges: phase1Result.summary.callersWithRanges,
  });

  return phase1Result;
}

/**
 * Write Phase 1 results to Parquet
 */
async function writeResultsToParquet(
  result: Phase1Result,
  parquetPath: string
): Promise<void> {
  // Use DuckDB to write Parquet
  const db = new DuckDBClient(':memory:');
  await db.execute('INSTALL parquet');
  await db.execute('LOAD parquet');

  // Create table from results
  await db.execute(`
    CREATE TABLE phase1_results AS
    SELECT * FROM (
      SELECT
        ?::TEXT as caller,
        ?::DOUBLE as tp_mult_min,
        ?::DOUBLE as tp_mult_max,
        ?::DOUBLE as tp_mult_optimal,
        ?::DOUBLE as sl_mult_min,
        ?::DOUBLE as sl_mult_max,
        ?::DOUBLE as sl_mult_optimal,
        ?::DOUBLE as win_rate,
        ?::DOUBLE as median_return_pct,
        ?::DOUBLE as hit2x_pct,
        ?::INTEGER as calls_count
      WHERE FALSE
    )
  `);

  // Insert rows
  for (const range of result.optimalRanges) {
    await db.execute(
      `
      INSERT INTO phase1_results VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        range.caller,
        range.tpMult.min,
        range.tpMult.max,
        range.tpMult.optimal || null,
        range.slMult.min,
        range.slMult.max,
        range.slMult.optimal || null,
        range.metrics.winRate,
        range.metrics.medianReturnPct,
        range.metrics.hit2xPct,
        range.metrics.callsCount,
      ]
    );
  }

  // Export to Parquet
  await db.execute(`COPY phase1_results TO '${parquetPath}' (FORMAT PARQUET)`);
  await db.close();

  logger.debug('Wrote Phase 1 results to Parquet', { parquetPath });
}

