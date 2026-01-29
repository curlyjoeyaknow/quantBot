/**
 * Create Experiment Handler (Research Package)
 *
 * Creates a new experiment with frozen artifact sets.
 * Uses ExperimentTrackerPort for experiment tracking.
 *
 * @packageDocumentation
 */

import type { z } from 'zod';
import type { CommandContext } from '../../../core/command-context.js';
import type { createResearchExperimentSchema } from '../../../command-defs/research-experiments.js';
import type { Experiment, ExperimentDefinition } from '@quantbot/core';
import { execSync } from 'child_process';

export type CreateResearchExperimentArgs = z.infer<typeof createResearchExperimentSchema>;

/**
 * Result from creating an experiment
 */
export interface CreateResearchExperimentResult {
  /** Created experiment */
  experiment: Experiment;
  /** Success message */
  message: string;
}

/**
 * Get git commit hash and dirty status
 */
function getGitProvenance(): { gitCommit: string; gitDirty: boolean } {
  try {
    const gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
    const gitDirty = gitStatus.length > 0;
    return { gitCommit, gitDirty };
  } catch (error) {
    // If git is not available, return placeholder
    return { gitCommit: 'unknown', gitDirty: false };
  }
}

/**
 * Create a new experiment
 *
 * Pure handler - depends only on ports.
 * Gets experiment tracker from context and calls createExperiment.
 *
 * Experiments declare frozen artifact sets (alerts, OHLCV, strategies)
 * and track execution status and output artifacts.
 *
 * Supports two modes:
 * 1. Explicit artifact IDs (--alerts, --ohlcv)
 * 2. RunSet reference (--runset) - resolves to concrete artifacts
 *
 * @param args - Validated arguments
 * @param ctx - Command context with services
 * @returns Created experiment
 *
 * @example
 * ```typescript
 * // Explicit mode
 * const result = await createResearchExperimentHandler(
 *   {
 *     name: 'momentum-v1',
 *     alerts: ['alert-1', 'alert-2'],
 *     ohlcv: ['ohlcv-1'],
 *     strategy: { name: 'momentum', threshold: 0.05 },
 *     from: '2025-05-01',
 *     to: '2025-05-31',
 *   },
 *   ctx
 * );
 *
 * // RunSet mode
 * const result = await createResearchExperimentHandler(
 *   {
 *     name: 'momentum-v1',
 *     runset: 'brook_baseline_2025Q4',
 *     from: '2025-05-01',
 *     to: '2025-05-31',
 *   },
 *   ctx
 * );
 * console.log(`Created: ${result.experiment.experimentId}`);
 * ```
 */
export async function createResearchExperimentHandler(
  args: CreateResearchExperimentArgs,
  ctx: CommandContext
): Promise<CreateResearchExperimentResult> {
  // Get services from context (lazy initialization)
  const experimentTracker = ctx.services.experimentTracker();

  // Resolve artifact IDs (either from explicit args or from RunSet)
  let alertArtifactIds: string[];
  let ohlcvArtifactIds: string[];
  let runsetMetadata: { runsetId: string; resolutionHash: string } | undefined;

  if (args.runset) {
    // RunSet mode: resolve RunSet to concrete artifact IDs
    const runsetResolver = ctx.services.runsetResolver();
    const resolution = await runsetResolver.resolveRunSet(args.runset);

    // Extract artifact IDs by kind
    const alertArtifacts = resolution.artifacts.filter((a) => a.kind.includes('alert'));
    const ohlcvArtifacts = resolution.artifacts.filter((a) => a.kind.includes('ohlcv'));

    alertArtifactIds = alertArtifacts.map((a) => a.artifactId);
    ohlcvArtifactIds = ohlcvArtifacts.map((a) => a.artifactId);

    runsetMetadata = {
      runsetId: args.runset,
      resolutionHash: resolution.contentHash,
    };
  } else {
    // Explicit mode: use provided artifact IDs
    alertArtifactIds = args.alerts || [];
    ohlcvArtifactIds = args.ohlcv || [];
  }

  // Generate experiment ID (timestamp-based)
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const experimentId = `exp-${timestamp}-${randomSuffix}`;

  // Get git provenance
  const { gitCommit, gitDirty } = getGitProvenance();

  // Build experiment definition
  const definition: ExperimentDefinition = {
    experimentId,
    name: args.name,
    description: args.description,
    inputs: {
      alerts: alertArtifactIds,
      ohlcv: ohlcvArtifactIds,
      strategies: args.strategies,
    },
    config: {
      strategy: args.strategy || {},
      dateRange: {
        from: args.from,
        to: args.to,
      },
      params: {
        ...args.params,
        // Add RunSet metadata if using RunSet mode
        ...(runsetMetadata ? { _runset: runsetMetadata } : {}),
      },
    },
    provenance: {
      gitCommit,
      gitDirty,
      engineVersion: '1.0.0', // TODO: Get from package.json
      createdAt: new Date().toISOString(),
    },
  };

  // Call port method (adapter handles DuckDB operations)
  const experiment = await experimentTracker.createExperiment(definition);

  return {
    experiment,
    message: `Experiment created: ${experimentId}`,
  };
}
