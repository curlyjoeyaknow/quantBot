/**
 * Optimization Workflow Orchestrator
 *
 * Coordinates all phases of the optimization workflow:
 * 1. Phase 1: Lab Sweep Discovery
 * 2. Phase 2: Backtest Optimization
 * 3. Phase 3: Stress Validation
 *
 * Writes all artifacts to data lake structure: data/lake/runs/run_id={workflowRunId}/
 */

import { v4 as uuidv4 } from 'uuid';
import { DateTime } from 'luxon';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type {
  OptimizationWorkflowConfig,
  OptimizationWorkflowResult,
  WorkflowRunMetadata,
  Phase1Result,
  Phase2Result,
  Phase3Result,
} from './phases/types.js';
import {
  createLakeRunDirectory,
  writeWorkflowManifest,
  writePhaseConfig,
  workflowRunExists,
  loadWorkflowManifest,
} from './phases/lake-directory.js';
import { runPhase1LabSweepDiscovery } from './phases/lab-sweep-discovery.js';
import { runPhase2BacktestOptimization } from './phases/backtest-optimization.js';
import { runPhase3StressValidation } from './phases/stress-validation.js';
import { logger } from '@quantbot/utils';
import { getDuckDBPath } from '@quantbot/utils';
// Git provenance helper
async function getGitProvenance(): Promise<{ commit: string; branch: string; dirty: boolean }> {
  const { execSync } = await import('child_process');
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    return { commit, branch, dirty: status.length > 0 };
  } catch {
    return { commit: 'unknown', branch: 'unknown', dirty: false };
  }
}

/**
 * Run complete optimization workflow
 */
export async function runOptimizationWorkflow(
  config: OptimizationWorkflowConfig
): Promise<OptimizationWorkflowResult> {
  // Generate workflow run ID
  const workflowRunId = uuidv4().substring(0, 12);
  const createdAt = DateTime.utc().toISO()!;

  logger.info('Starting optimization workflow', {
    workflowRunId,
    dateFrom: config.dateFrom,
    dateTo: config.dateTo,
  });

  // Create data lake directory structure
  const runDir = await createLakeRunDirectory(config.dataRoot, workflowRunId);

  // Initialize metadata
  const metadata: WorkflowRunMetadata = {
    workflowRunId,
    createdAt,
    status: 'running',
    phases: {
      phase1: 'pending',
      phase2: 'pending',
      phase3: 'pending',
    },
  };

  // Get git provenance
  try {
    const gitInfo = await getGitProvenance();
    metadata.gitCommit = gitInfo.commit;
    metadata.gitBranch = gitInfo.branch;
    metadata.gitDirty = gitInfo.dirty;
  } catch (error) {
    logger.warn('Failed to get git provenance', { error: error instanceof Error ? error.message : String(error) });
  }

  // Check for resume
  let phase1Result: Phase1Result | undefined;
  let phase2Result: Phase2Result | undefined;
  let phase3Result: Phase3Result | undefined;

  if (config.resume && workflowRunExists(config.dataRoot, workflowRunId)) {
    const existingManifest = await loadWorkflowManifest(runDir);
    if (existingManifest) {
      logger.info('Resuming workflow', { workflowRunId });
      metadata.phases = existingManifest.phases;

      // Load existing phase results if completed
      if (existingManifest.phases.phase1 === 'completed') {
        try {
          const phase1SummaryPath = join(runDir, 'phase1', 'summary.json');
          if (existsSync(phase1SummaryPath)) {
            const optimalRangesPath = join(runDir, 'phase1', 'optimal-ranges.json');
            const optimalRanges = JSON.parse(await readFile(optimalRangesPath, 'utf-8'));
            const summary = JSON.parse(await readFile(phase1SummaryPath, 'utf-8'));
            phase1Result = { optimalRanges, summary };
          }
        } catch (error) {
          logger.warn('Failed to load Phase 1 results', {
          error: error instanceof Error ? error.message : String(error),
        });
        }
      }

      if (existingManifest.phases.phase2 === 'completed') {
        try {
          const phase2SummaryPath = join(runDir, 'phase2', 'summary.json');
          if (existsSync(phase2SummaryPath)) {
            const islandsPath = join(runDir, 'phase2', 'islands.json');
            const championsPath = join(runDir, 'phase2', 'champions.json');
            const islands = JSON.parse(await readFile(islandsPath, 'utf-8'));
            const champions = JSON.parse(await readFile(championsPath, 'utf-8'));
            const summary = JSON.parse(await readFile(phase2SummaryPath, 'utf-8'));
            phase2Result = { islands, champions, summary };
          }
        } catch (error) {
          logger.warn('Failed to load Phase 2 results', {
          error: error instanceof Error ? error.message : String(error),
        });
        }
      }
    }
  }

  // Write initial manifest
  await writeWorkflowManifest(runDir, metadata);

  // Write phase configs
  await writePhaseConfig(runDir, 'phase1', config.phase1);
  await writePhaseConfig(runDir, 'phase2', config.phase2);
  await writePhaseConfig(runDir, 'phase3', config.phase3);

  // Get DuckDB path
  const duckdbPath = getDuckDBPath();
  const slicePath = 'slices/per_token'; // Default slice path

  try {
    // Phase 1: Lab Sweep Discovery
    if (config.phase1.enabled && metadata.phases.phase1 !== 'completed') {
      metadata.phases.phase1 = 'running';
      await writeWorkflowManifest(runDir, metadata);

      try {
        phase1Result = await runPhase1LabSweepDiscovery(
          config.phase1,
          config.dateFrom,
          config.dateTo,
          config.callers,
          runDir,
          duckdbPath
        );

        metadata.phases.phase1 = 'completed';
        await writeWorkflowManifest(runDir, metadata);
      } catch (error) {
        metadata.phases.phase1 = 'failed';
        await writeWorkflowManifest(runDir, metadata);
        throw error;
      }
    }

    // Phase 2: Backtest Optimization
    if (config.phase2.enabled && metadata.phases.phase2 !== 'completed') {
      if (!phase1Result && config.phase1.enabled) {
        throw new Error('Phase 1 must complete before Phase 2');
      }

      metadata.phases.phase2 = 'running';
      await writeWorkflowManifest(runDir, metadata);

      try {
        phase2Result = await runPhase2BacktestOptimization(
          config.phase2,
          config.dateFrom,
          config.dateTo,
          phase1Result,
          runDir,
          duckdbPath,
          slicePath
        );

        metadata.phases.phase2 = 'completed';
        await writeWorkflowManifest(runDir, metadata);
      } catch (error) {
        metadata.phases.phase2 = 'failed';
        await writeWorkflowManifest(runDir, metadata);
        throw error;
      }
    }

    // Phase 3: Stress Validation
    if (config.phase3.enabled && metadata.phases.phase3 !== 'completed') {
      if (!phase2Result && config.phase2.enabled) {
        throw new Error('Phase 2 must complete before Phase 3');
      }

      if (!phase2Result || phase2Result.champions.length === 0) {
        logger.warn('No champions from Phase 2, skipping Phase 3');
        metadata.phases.phase3 = 'skipped';
        await writeWorkflowManifest(runDir, metadata);
      } else {
        metadata.phases.phase3 = 'running';
        await writeWorkflowManifest(runDir, metadata);

        try {
          phase3Result = await runPhase3StressValidation(
            config.phase3,
            config.dateFrom,
            config.dateTo,
            phase2Result.champions,
            runDir,
            duckdbPath,
            slicePath
          );

          metadata.phases.phase3 = 'completed';
          await writeWorkflowManifest(runDir, metadata);
        } catch (error) {
          metadata.phases.phase3 = 'failed';
          await writeWorkflowManifest(runDir, metadata);
          throw error;
        }
      }
    }

    // Write final summary
    const finalSummary = {
      workflowRunId,
      dateFrom: config.dateFrom,
      dateTo: config.dateTo,
      phase1: phase1Result?.summary,
      phase2: phase2Result?.summary,
      phase3: phase3Result?.summary,
      winner: phase3Result?.winner,
    };

    const summaryPath = join(runDir, 'outputs', 'workflow-summary.json');
    await writeFile(summaryPath, JSON.stringify(finalSummary, null, 2), 'utf-8');

    // Write final parameters per caller
    if (phase3Result?.winner && phase2Result) {
      const winnerChampion = phase2Result.champions.find(
        (c) => c.championId === phase3Result!.winner!.championId
      );
      if (winnerChampion) {
        const finalParams = {
          workflowRunId,
          winner: {
            championId: winnerChampion.championId,
            tpMult: winnerChampion.tpMult,
            slMult: winnerChampion.slMult,
            params: JSON.parse(winnerChampion.paramsJson),
            validationScore: phase3Result.winner.maximinScore,
          },
        };
        const finalParamsPath = join(runDir, 'outputs', 'final-parameters.json');
        await writeFile(finalParamsPath, JSON.stringify(finalParams, null, 2), 'utf-8');
      }
    }

    // Mark workflow as completed
    metadata.status = 'completed';
    metadata.completedAt = DateTime.utc().toISO()!;
    await writeWorkflowManifest(runDir, metadata);

    logger.info('Optimization workflow completed', {
      workflowRunId,
      runDir,
    });

    return {
      workflowRunId,
      metadata,
      phase1: phase1Result,
      phase2: phase2Result,
      phase3: phase3Result,
    };
  } catch (error) {
    // Mark workflow as failed
    metadata.status = 'failed';
    await writeWorkflowManifest(runDir, metadata);

    logger.error('Optimization workflow failed', {
      workflowRunId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      workflowRunId,
      metadata,
      phase1: phase1Result,
      phase2: phase2Result,
      phase3: phase3Result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

