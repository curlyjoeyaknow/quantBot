/**
 * Phase 2: Backtest Optimization
 *
 * Full parameter optimization with expanded parameter space, using walk-forward validation.
 * Integrates with Python run_random_search.py which writes to Parquet ledger.
 */

import { join } from 'path';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { Phase2Config, Phase2Result, ParameterIsland, IslandChampion } from './types.js';
import { logger } from '@quantbot/utils';
import { PythonEngine } from '@quantbot/utils';
import { findWorkspaceRoot } from '@quantbot/utils';
import { DuckDBClient } from '@quantbot/storage';
import { z } from 'zod';
import { getPhaseArtifactPath } from './lake-directory.js';
import type { Phase1Result } from './types.js';

/**
 * Run Phase 2: Backtest Optimization
 */
export async function runPhase2BacktestOptimization(
  config: Phase2Config,
  dateFrom: string,
  dateTo: string,
  phase1Result: Phase1Result | undefined,
  runDir: string,
  duckdbPath: string,
  slicePath: string
): Promise<Phase2Result> {
  logger.info('Starting Phase 2: Backtest Optimization', {
    mode: config.mode,
    nTrials: config.nTrials,
    nFolds: config.nFolds,
  });

  // Load optimal ranges from Phase 1 if available
  let tpMin = 1.5;
  let tpMax = 3.5;
  let slMin = 0.30;
  let slMax = 0.60;

  if (phase1Result && phase1Result.optimalRanges.length > 0) {
    // Use ranges from Phase 1 (aggregate across callers)
    const allTpMins = phase1Result.optimalRanges.map((r) => r.tpMult.min);
    const allTpMaxs = phase1Result.optimalRanges.map((r) => r.tpMult.max);
    const allSlMins = phase1Result.optimalRanges.map((r) => r.slMult.min);
    const allSlMaxs = phase1Result.optimalRanges.map((r) => r.slMult.max);

    tpMin = Math.min(...allTpMins);
    tpMax = Math.max(...allTpMaxs);
    slMin = Math.min(...allSlMins);
    slMax = Math.max(...allSlMaxs);

    logger.info('Using Phase 1 optimal ranges', {
      tpMin,
      tpMax,
      slMin,
      slMax,
    });
  }

  // Determine mode-specific parameters
  const modeParams = getModeParams(config.mode, config.nTrials, config.nFolds);

  // Prepare Python script arguments as object (PythonEngine converts to CLI args)
  const pythonArgs: Record<string, string | number | boolean> = {
    from: dateFrom,
    to: dateTo,
    trials: modeParams.nTrials,
    'n-folds': modeParams.nFolds,
    'tp-min': tpMin,
    'tp-max': tpMax,
    'sl-min': slMin,
    'sl-max': slMax,
    duckdb: duckdbPath,
    slice: slicePath,
    'output-dir': join(runDir, 'phase2', 'python-output'),
    json: true,
    robust: true,
    'top-n': 30,
    'n-clusters': 3,
    'validate-champions': true,
    'stress-lanes': 'full',
  };

  if (config.extendedParams) {
    pythonArgs['extended-exits'] = true;
    pythonArgs['tiered-sl'] = true;
    pythonArgs['delayed-entry'] = true;
  }

  // Add mode-specific arguments
  if (modeParams.trainDays) {
    pythonArgs['train-days'] = modeParams.trainDays;
  }
  if (modeParams.testDays) {
    pythonArgs['test-days'] = modeParams.testDays;
  }
  if (modeParams.foldStep) {
    pythonArgs['fold-step'] = modeParams.foldStep;
  }

  // Run Python script
  const pythonEngine = new PythonEngine();
  const scriptPath = join(findWorkspaceRoot(), 'tools/backtest/run_random_search.py');
  const outputDir = join(runDir, 'phase2', 'python-output');

  logger.info('Running Python optimization script', {
    scriptPath,
    outputDir,
  });

  try {
    // Execute Python script (it writes Parquet files directly)
    // Note: runScript expects JSON output, but this script outputs to files
    // So we use expectJsonOutput: false and check for file outputs
    await pythonEngine.runScript(
      scriptPath,
      pythonArgs,
      z.any(),
      {
        timeout: 60 * 60 * 1000, // 1 hour timeout
        cwd: findWorkspaceRoot(),
        expectJsonOutput: false,
      }
    );

    // Read results from JSON output
    const jsonOutputPath = join(outputDir, 'results.json');
    if (!existsSync(jsonOutputPath)) {
      throw new Error(`Python script did not produce results.json at ${jsonOutputPath}`);
    }

    const jsonOutput = JSON.parse(await readFile(jsonOutputPath, 'utf-8'));

    // Extract islands and champions from output
    const islands: ParameterIsland[] = [];
    const champions: IslandChampion[] = [];

    if (jsonOutput.robust_mode?.islands) {
      for (const island of jsonOutput.robust_mode.islands) {
        islands.push({
          islandId: island.island_id || String(islands.length),
          centroid: {
            tpMult: island.centroid?.tp_mult || 0,
            slMult: island.centroid?.sl_mult || 0,
            paramsJson: JSON.stringify(island.centroid || {}),
          },
          nMembers: island.n_members || 0,
          meanRobustScore: island.mean_robust_score || 0,
          bestRobustScore: island.best_robust_score || 0,
        });
      }
    }

    if (jsonOutput.robust_mode?.champions) {
      for (const champ of jsonOutput.robust_mode.champions) {
        champions.push({
          championId: champ.champion_id || String(champions.length),
          islandId: champ.island_id || '',
          tpMult: champ.params?.tp_mult || 0,
          slMult: champ.params?.sl_mult || 0,
          paramsJson: JSON.stringify(champ.params || {}),
          discoveryScore: champ.discovery_score || 0,
          passesGates: champ.passes_gates || false,
        });
      }
    }

    // Read trials Parquet file path (Python script writes it)
    const trialsParquetPath = join(outputDir, 'trials.parquet');
    const tradesParquetPath = join(outputDir, 'trades.parquet');

    // Copy Parquet files to phase2 directory
    if (existsSync(trialsParquetPath)) {
      const { copyFile } = await import('fs/promises');
      const destTrialsPath = getPhaseArtifactPath(runDir, 'phase2', 'trials.parquet');
      await copyFile(trialsParquetPath, destTrialsPath);
      logger.debug('Copied trials Parquet', { destTrialsPath });
    }

    if (existsSync(tradesParquetPath)) {
      const { copyFile } = await import('fs/promises');
      const destTradesPath = getPhaseArtifactPath(runDir, 'phase2', 'trades.parquet');
      await copyFile(tradesParquetPath, destTradesPath);
      logger.debug('Copied trades Parquet', { destTradesPath });
    }

    const phase2Result: Phase2Result = {
      islands,
      champions,
      summary: {
        totalTrials: jsonOutput.summary?.total_trials || 0,
        islandsFound: islands.length,
        championsSelected: champions.length,
      },
    };

    // Write metadata JSON files
    const islandsPath = getPhaseArtifactPath(runDir, 'phase2', 'islands.json');
    await writeFile(islandsPath, JSON.stringify(islands, null, 2), 'utf-8');

    const championsPath = getPhaseArtifactPath(runDir, 'phase2', 'champions.json');
    await writeFile(championsPath, JSON.stringify(champions, null, 2), 'utf-8');

    const summaryPath = getPhaseArtifactPath(runDir, 'phase2', 'summary.json');
    await writeFile(summaryPath, JSON.stringify(phase2Result.summary, null, 2), 'utf-8');

    logger.info('Phase 2 completed', {
      islandsFound: phase2Result.summary.islandsFound,
      championsSelected: phase2Result.summary.championsSelected,
    });

    return phase2Result;
  } catch (error) {
    logger.error('Phase 2 failed', error as Error);
    throw error;
  }
}

/**
 * Get mode-specific parameters
 */
function getModeParams(
  mode: 'cheap' | 'serious' | 'war_room',
  nTrials: number,
  nFolds: number
): {
  nTrials: number;
  nFolds: number;
  trainDays?: number;
  testDays?: number;
  foldStep?: number;
} {
  switch (mode) {
    case 'cheap':
      return {
        nTrials: Math.min(nTrials, 200),
        nFolds: Math.min(nFolds, 3),
        trainDays: 7,
        testDays: 3,
        foldStep: 3,
      };
    case 'serious':
      return {
        nTrials,
        nFolds,
        trainDays: 14,
        testDays: 7,
        foldStep: 7,
      };
    case 'war_room':
      return {
        nTrials: Math.max(nTrials, 2000),
        nFolds: Math.max(nFolds, 8),
        trainDays: 21,
        testDays: 7,
        foldStep: 7,
      };
  }
}

