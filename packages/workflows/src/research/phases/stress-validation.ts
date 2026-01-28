/**
 * Phase 3: Parameter Island Stress Suite
 *
 * Validates island champions across rolling windows and stress lanes.
 * Uses rolling windows to test various combinations of parameters.
 */

import { DateTime } from 'luxon';
import { join } from 'path';
import { writeFile } from 'fs/promises';
import { z } from 'zod';
import type {
  Phase3Config,
  Phase3Result,
  ChampionValidation,
  StressWindowResult,
} from './types.js';
import { logger } from '@quantbot/utils';
import { DuckDBClient } from '@quantbot/storage';
import { getPhaseArtifactPath } from './lake-directory.js';
import type { IslandChampion } from './types.js';

/**
 * Generate rolling windows from date range
 */
export function generateRollingWindows(
  dateFrom: string,
  dateTo: string,
  trainDays: number,
  testDays: number,
  stepDays: number
): Array<{
  windowId: string;
  trainFrom: string;
  trainTo: string;
  testFrom: string;
  testTo: string;
}> {
  const windows: Array<{
    windowId: string;
    trainFrom: string;
    trainTo: string;
    testFrom: string;
    testTo: string;
  }> = [];

  let currentStart = DateTime.fromISO(dateFrom);
  const endDate = DateTime.fromISO(dateTo);
  let windowIndex = 0;

  while (currentStart.plus({ days: trainDays + testDays }).toMillis() <= endDate.toMillis()) {
    const trainFrom = currentStart;
    const trainTo = trainFrom.plus({ days: trainDays });
    const testFrom = trainTo;
    const testTo = testFrom.plus({ days: testDays });

    if (testTo.toMillis() > endDate.toMillis()) {
      break;
    }

    windows.push({
      windowId: `window_${windowIndex}`,
      trainFrom: trainFrom.toISO()!,
      trainTo: trainTo.toISO()!,
      testFrom: testFrom.toISO()!,
      testTo: testTo.toISO()!,
    });

    // Slide forward
    currentStart = currentStart.plus({ days: stepDays });
    windowIndex++;
  }

  return windows;
}

/**
 * Load alerts from DuckDB for a date range
 */
async function loadAlertsForWindow(
  duckdbPath: string,
  testFrom: string,
  testTo: string
): Promise<Array<{ call_id: string; caller: string; mint: string; ts: string; chain: string }>> {
  const { DuckDBClient } = await import('@quantbot/storage');
  const db = new DuckDBClient(duckdbPath);

  const fromMs = new Date(testFrom).getTime();
  const toMs = new Date(testTo).getTime();

  const query = `
    SELECT 
      call_id,
      caller,
      mint,
      ts_ms,
      chain
    FROM alerts
    WHERE ts_ms >= ${fromMs} AND ts_ms < ${toMs}
    ORDER BY ts_ms
  `;

  const result = await db.query(query);
  await db.close();

  // DuckDBQueryResult has a rows property
  const rows = (result as { rows?: unknown[] }).rows || [];
  return rows.map((rowRaw: unknown) => {
    const row = rowRaw as Record<string, unknown>;
    return {
      call_id: row.call_id as string,
      caller: row.caller as string,
      mint: row.mint as string,
      ts: new Date(row.ts_ms as number).toISOString(),
      chain: (row.chain as string) || 'solana',
    };
  });
}

/**
 * Run backtest for a champion in a specific window with stress lane conditions
 */
async function runStressLaneBacktest(
  champion: IslandChampion,
  window: { trainFrom: string; trainTo: string; testFrom: string; testTo: string },
  lane: {
    name: string;
    feeBps: number;
    slippageBps: number;
    latencyCandles: number;
    stopGapProb: number;
    stopGapMult: number;
  },
  duckdbPath: string,
  slicePath: string
): Promise<{
  testR: number;
  ratio: number;
  passesGates: boolean;
}> {
  logger.debug('Running stress lane backtest', {
    champion: champion.championId,
    testFrom: window.testFrom,
    testTo: window.testTo,
    lane: lane.name,
  });

  try {
    // Load alerts for test window
    const alerts = await loadAlertsForWindow(duckdbPath, window.testFrom, window.testTo);

    if (alerts.length === 0) {
      logger.warn('No alerts found for stress lane backtest', {
        testFrom: window.testFrom,
        testTo: window.testTo,
      });
      return {
        testR: 0,
        ratio: 1.0,
        passesGates: false,
      };
    }

    // Parse champion parameters
    const params = JSON.parse(champion.paramsJson);
    const tpMult = params.tp_mult || champion.tpMult;
    const slMult = params.sl_mult || champion.slMult;

    // Call Python stress validation script
    const { PythonEngine } = await import('@quantbot/utils');
    const { findWorkspaceRoot } = await import('@quantbot/utils');
    const { join } = await import('path');

    const pythonEngine = new PythonEngine();
    const scriptPath = join(findWorkspaceRoot(), 'tools/backtest/run_stress_validation.py');

    const config = {
      alerts,
      slice_path: slicePath,
      interval_seconds: 60,
      horizon_hours: 48,
      tp_mult: tpMult,
      sl_mult: slMult,
      fee_bps: lane.feeBps,
      slippage_bps: lane.slippageBps,
      entry_delay_candles: lane.latencyCandles,
      stop_gap_prob: lane.stopGapProb,
      stop_gap_mult: lane.stopGapMult,
      risk_per_trade: 0.02,
      discovery_score: champion.discoveryScore,
    };

    // Use runScriptWithStdin to pass JSON config via stdin
    const result = await pythonEngine.runScriptWithStdin(
      scriptPath,
      JSON.stringify(config),
      z.object({
        test_r: z.number(),
        ratio: z.number(),
        passes_gates: z.boolean(),
        summary: z.record(z.string(), z.unknown()).optional(),
      }),
      {
        timeout: 5 * 60 * 1000, // 5 minutes
      }
    );

    return {
      testR: result.test_r || 0,
      ratio: result.ratio || 1.0,
      passesGates: result.passes_gates || false,
    };
  } catch (error) {
    logger.error('Stress lane backtest failed', error as Error, {
      champion: champion.championId,
      lane: lane.name,
    });
    // Return safe defaults on error
    return {
      testR: 0,
      ratio: 1.0,
      passesGates: false,
    };
  }
}

/**
 * Get stress lanes based on lane pack
 */
function getStressLanes(lanePack: 'minimal' | 'full'): Array<{
  name: string;
  feeBps: number;
  slippageBps: number;
  latencyCandles: number;
  stopGapProb: number;
  stopGapMult: number;
}> {
  const baseline = {
    name: 'baseline',
    feeBps: 30,
    slippageBps: 50,
    latencyCandles: 0,
    stopGapProb: 0,
    stopGapMult: 1.0,
  };

  if (lanePack === 'minimal') {
    return [baseline];
  }

  // Full lane pack
  return [
    baseline,
    {
      name: 'high_fees',
      feeBps: 60,
      slippageBps: 50,
      latencyCandles: 0,
      stopGapProb: 0,
      stopGapMult: 1.0,
    },
    {
      name: 'high_slippage',
      feeBps: 30,
      slippageBps: 100,
      latencyCandles: 0,
      stopGapProb: 0,
      stopGapMult: 1.0,
    },
    {
      name: 'latency',
      feeBps: 30,
      slippageBps: 50,
      latencyCandles: 2,
      stopGapProb: 0,
      stopGapMult: 1.0,
    },
    {
      name: 'stop_gaps',
      feeBps: 30,
      slippageBps: 50,
      latencyCandles: 0,
      stopGapProb: 0.15,
      stopGapMult: 1.5,
    },
  ];
}

/**
 * Run Phase 3: Stress Validation
 */
export async function runPhase3StressValidation(
  config: Phase3Config,
  dateFrom: string,
  dateTo: string,
  champions: IslandChampion[],
  runDir: string,
  duckdbPath: string,
  slicePath: string
): Promise<Phase3Result> {
  logger.info('Starting Phase 3: Stress Validation', {
    trainDays: config.trainDays,
    testDays: config.testDays,
    stepDays: config.stepDays,
    championsCount: champions.length,
  });

  // Generate rolling windows
  const windows = generateRollingWindows(
    dateFrom,
    dateTo,
    config.trainDays,
    config.testDays,
    config.stepDays
  );

  logger.info('Generated rolling windows', { windowsCount: windows.length });

  // Get stress lanes
  const stressLanes = getStressLanes(config.lanePack);

  // Validate each champion across all windows and lanes
  const validations: ChampionValidation[] = [];

  for (const champion of champions) {
    logger.info('Validating champion', { championId: champion.championId });

    const windowResults: StressWindowResult[] = [];

    for (const window of windows) {
      const laneResults: Record<string, { testR: number; ratio: number; passesGates: boolean }> =
        {};

      for (const lane of stressLanes) {
        const result = await runStressLaneBacktest(champion, window, lane, duckdbPath, slicePath);
        laneResults[lane.name] = result;
      }

      windowResults.push({
        windowId: window.windowId,
        trainFrom: window.trainFrom,
        trainTo: window.trainTo,
        testFrom: window.testFrom,
        testTo: window.testTo,
        laneResults,
      });
    }

    // Compute aggregate scores across windows
    const allScores = windowResults.flatMap((wr) =>
      Object.values(wr.laneResults).map(
        (lr: { testR: number; ratio: number; passesGates: boolean }) => lr.testR
      )
    );
    const maximinScore = Math.min(...allScores);
    const medianScore = allScores.sort((a, b) => a - b)[Math.floor(allScores.length / 2)] || 0;
    const meanScore = allScores.reduce((a, b) => a + b, 0) / allScores.length || 0;

    // Find worst window and lane
    let worstWindow = '';
    let worstLane = '';
    let worstScore = Infinity;

    for (const wr of windowResults) {
      for (const [laneName, laneResult] of Object.entries(wr.laneResults)) {
        const result = laneResult as { testR: number; ratio: number; passesGates: boolean };
        if (result.testR < worstScore) {
          worstScore = result.testR;
          worstWindow = wr.windowId;
          worstLane = laneName;
        }
      }
    }

    validations.push({
      championId: champion.championId,
      windows: windowResults,
      maximinScore,
      medianScore,
      meanScore,
      worstWindow,
      worstLane,
    });
  }

  // Rank champions by maximin score
  validations.sort((a, b) => b.maximinScore - a.maximinScore);
  for (let i = 0; i < validations.length; i++) {
    const validation = validations[i];
    if (validation) {
      validation.validationRank = i + 1;
    }
  }

  const winner = validations[0];

  const phase3Result: Phase3Result = {
    validations,
    winner,
    summary: {
      totalWindows: windows.length,
      championsValidated: validations.length,
    },
  };

  // Write results to Parquet
  const stressResultsPath = getPhaseArtifactPath(runDir, 'phase3', 'stress-results.parquet');
  await writeStressResultsToParquet(phase3Result, stressResultsPath);

  // Write metadata JSON files
  const validationPath = getPhaseArtifactPath(runDir, 'phase3', 'validation.json');
  await writeFile(validationPath, JSON.stringify(validations, null, 2), 'utf-8');

  if (winner) {
    const winnerPath = getPhaseArtifactPath(runDir, 'phase3', 'winner.json');
    await writeFile(winnerPath, JSON.stringify(winner, null, 2), 'utf-8');
  }

  const summaryPath = getPhaseArtifactPath(runDir, 'phase3', 'summary.json');
  await writeFile(summaryPath, JSON.stringify(phase3Result.summary, null, 2), 'utf-8');

  logger.info('Phase 3 completed', {
    championsValidated: phase3Result.summary.championsValidated,
    winner: winner?.championId,
  });

  return phase3Result;
}

/**
 * Write stress results to Parquet
 */
async function writeStressResultsToParquet(
  result: Phase3Result,
  parquetPath: string
): Promise<void> {
  const db = new DuckDBClient(':memory:');
  await db.execute('INSTALL parquet');
  await db.execute('LOAD parquet');

  // Create table schema
  await db.execute(`
    CREATE TABLE stress_results AS
    SELECT * FROM (
      SELECT
        ?::TEXT as champion_id,
        ?::TEXT as window_id,
        ?::TEXT as lane_name,
        ?::DOUBLE as test_r,
        ?::DOUBLE as ratio,
        ?::BOOLEAN as passes_gates,
        ?::DOUBLE as maximin_score,
        ?::DOUBLE as median_score,
        ?::DOUBLE as mean_score,
        ?::TEXT as worst_window,
        ?::TEXT as worst_lane,
        ?::INTEGER as validation_rank
      WHERE FALSE
    )
  `);

  // Insert rows - build SQL with values directly (DuckDBClient.execute doesn't support parameters)
  const insertValues: string[] = [];
  for (const validation of result.validations) {
    for (const window of validation.windows) {
      for (const [laneName, laneResultRaw] of Object.entries(window.laneResults)) {
        const laneResult = laneResultRaw as { testR: number; ratio: number; passesGates: boolean };
        const values = [
          `'${validation.championId.replace(/'/g, "''")}'`,
          `'${window.windowId.replace(/'/g, "''")}'`,
          `'${laneName.replace(/'/g, "''")}'`,
          String(laneResult.testR),
          String(laneResult.ratio),
          laneResult.passesGates ? 'true' : 'false',
          String(validation.maximinScore),
          String(validation.medianScore),
          String(validation.meanScore),
          validation.worstWindow ? `'${validation.worstWindow.replace(/'/g, "''")}'` : 'NULL',
          validation.worstLane ? `'${validation.worstLane.replace(/'/g, "''")}'` : 'NULL',
          validation.validationRank ? String(validation.validationRank) : 'NULL',
        ];
        insertValues.push(`(${values.join(', ')})`);
      }
    }
  }

  if (insertValues.length > 0) {
    await db.execute(`
      INSERT INTO stress_results VALUES ${insertValues.join(', ')}
    `);
  }

  // Export to Parquet
  await db.execute(`COPY stress_results TO '${parquetPath}' (FORMAT PARQUET)`);
  await db.close();

  logger.debug('Wrote Phase 3 stress results to Parquet', { parquetPath });
}
