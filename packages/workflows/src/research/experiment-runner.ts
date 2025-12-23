/**
 * Research OS - Experiment Runner
 * =================================
 *
 * Orchestrates simulation runs:
 * - Single simulation
 * - Batch simulations
 * - Parameter sweeps
 * - Replay by run ID
 */

import { z } from 'zod';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import { ValidationError, NotFoundError } from '@quantbot/utils';
import type { SimulationRequest } from './contract.js';
import type { RunArtifact } from './artifacts.js';
import { SimulationRequestSchema } from './contract.js';
import { RunArtifactSchema } from './artifacts.js';
import { createExperimentContext } from './context.js';

/**
 * Context for experiment runner
 */
export interface ExperimentContext {
  /**
   * Logger
   */
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };

  /**
   * ID generator
   */
  ids: {
    newRunId: () => string;
  };

  /**
   * Clock
   */
  clock: {
    nowISO: () => string;
  };

  /**
   * Artifact storage
   */
  artifacts: {
    /**
     * Save an artifact
     */
    save: (artifact: RunArtifact) => Promise<void>;

    /**
     * Load an artifact by run ID
     */
    load: (runId: string) => Promise<RunArtifact | null>;

    /**
     * List all run IDs
     */
    list: (options?: { limit?: number; offset?: number }) => Promise<string[]>;
  };

  /**
   * Simulation engine
   * This is the actual simulation implementation
   */
  simulation: {
    /**
     * Run a simulation
     */
    run: (request: SimulationRequest) => Promise<RunArtifact>;
  };
}

/**
 * Single simulation run
 */
export async function runSingleSimulation(
  request: SimulationRequest,
  ctx: ExperimentContext = createExperimentContext()
): Promise<RunArtifact> {
  // Validate request
  const parsed = SimulationRequestSchema.safeParse(request);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid simulation request: ${msg}`, {
      request,
      issues: parsed.error.issues,
    });
  }

  ctx.logger.info('[experiment.runSingle] starting', {
    runId: 'pending',
    strategyId: request.strategy.strategyId,
    snapshotId: request.dataSnapshot.snapshotId,
  });

  // Run simulation
  const artifact = await ctx.simulation.run(request);

  // Save artifact
  await ctx.artifacts.save(artifact);

  ctx.logger.info('[experiment.runSingle] completed', {
    runId: artifact.metadata.runId,
    metrics: artifact.metrics,
  });

  return artifact;
}

/**
 * Batch simulation run
 *
 * Runs multiple simulations in parallel (with concurrency limit)
 */
export interface BatchSimulationRequest {
  /**
   * Base request (will be cloned for each run)
   */
  baseRequest: SimulationRequest;

  /**
   * Variations to apply
   * Each variation will create a new run with modified parameters
   */
  variations: Array<{
    /**
     * Unique identifier for this variation
     */
    variationId: string;

    /**
     * Overrides to apply to base request
     */
    overrides: Partial<SimulationRequest>;
  }>;

  /**
   * Maximum concurrent simulations
   */
  maxConcurrency?: number;
}

export interface BatchSimulationResult {
  /**
   * Run IDs for all simulations
   */
  runIds: string[];

  /**
   * Successful runs
   */
  successful: string[];

  /**
   * Failed runs (with errors)
   */
  failed: Array<{
    variationId: string;
    runId?: string;
    error: string;
  }>;
}

export async function runBatchSimulation(
  batch: BatchSimulationRequest,
  ctx: ExperimentContext = createExperimentContext()
): Promise<BatchSimulationResult> {
  const maxConcurrency = batch.maxConcurrency ?? 4;
  const runIds: string[] = [];
  const successful: string[] = [];
  const failed: Array<{ variationId: string; runId?: string; error: string }> = [];

  ctx.logger.info('[experiment.runBatch] starting', {
    variations: batch.variations.length,
    maxConcurrency,
  });

  // Process in batches
  for (let i = 0; i < batch.variations.length; i += maxConcurrency) {
    const batchSlice = batch.variations.slice(i, i + maxConcurrency);

    const promises = batchSlice.map(async (variation) => {
      const runId = ctx.ids.newRunId();
      runIds.push(runId);

      try {
        // Merge base request with overrides
        const request: SimulationRequest = {
          ...batch.baseRequest,
          ...variation.overrides,
          // Deep merge nested objects
          dataSnapshot: {
            ...batch.baseRequest.dataSnapshot,
            ...variation.overrides.dataSnapshot,
          },
          strategy: {
            ...batch.baseRequest.strategy,
            ...variation.overrides.strategy,
          },
          executionModel: {
            ...batch.baseRequest.executionModel,
            ...variation.overrides.executionModel,
          },
          costModel: {
            ...batch.baseRequest.costModel,
            ...variation.overrides.costModel,
          },
          riskModel: variation.overrides.riskModel ?? batch.baseRequest.riskModel,
          runConfig: {
            ...batch.baseRequest.runConfig,
            ...variation.overrides.runConfig,
          },
        };

        const artifact = await ctx.simulation.run(request);
        await ctx.artifacts.save(artifact);

        successful.push(runId);
        if (ctx.logger.debug) {
          ctx.logger.debug('[experiment.runBatch] variation completed', {
            variationId: variation.variationId,
            runId,
          });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        failed.push({
          variationId: variation.variationId,
          runId,
          error: errorMsg,
        });
        ctx.logger.warn('[experiment.runBatch] variation failed', {
          variationId: variation.variationId,
          runId,
          error: errorMsg,
        });
      }
    });

    await Promise.all(promises);
  }

  ctx.logger.info('[experiment.runBatch] completed', {
    total: batch.variations.length,
    successful: successful.length,
    failed: failed.length,
  });

  return { runIds, successful, failed };
}

/**
 * Parameter sweep
 *
 * Systematically explores parameter space
 */
export interface ParameterSweepRequest {
  /**
   * Base request
   */
  baseRequest: SimulationRequest;

  /**
   * Parameters to sweep
   * Each parameter defines a range of values to test
   */
  parameters: Array<{
    /**
     * Parameter path (e.g., "executionModel.slippage.base")
     */
    path: string;

    /**
     * Values to test
     */
    values: unknown[];
  }>;

  /**
   * Maximum concurrent simulations
   */
  maxConcurrency?: number;
}

/**
 * Helper to set nested property by path
 */
function setNestedProperty(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]!] = value;
}

/**
 * Generate all combinations of parameter values
 */
function generateParameterCombinations(
  parameters: ParameterSweepRequest['parameters']
): Array<Record<string, unknown>> {
  if (parameters.length === 0) return [{}];

  if (parameters.length === 0) return [{}];

  const [first, ...rest] = parameters;
  if (!first) return [{}];

  const restCombinations = generateParameterCombinations(rest);

  const combinations: Array<Record<string, unknown>> = [];

  for (const value of first!.values) {
    for (const restCombo of restCombinations) {
      combinations.push({
        [first!.path]: value,
        ...restCombo,
      });
    }
  }

  return combinations;
}

export async function runParameterSweep(
  sweep: ParameterSweepRequest,
  ctx: ExperimentContext = createExperimentContext()
): Promise<BatchSimulationResult> {
  // Generate all parameter combinations
  const combinations = generateParameterCombinations(sweep.parameters);

  ctx.logger.info('[experiment.runSweep] generated combinations', {
    total: combinations.length,
    parameters: sweep.parameters.length,
  });

  // Convert to batch format
  const variations = combinations.map((combo, index) => {
    const overrides: Partial<SimulationRequest> = {};

    // Apply each parameter
    for (const [path, value] of Object.entries(combo)) {
      setNestedProperty(overrides, path, value);
    }

    return {
      variationId: `sweep-${index}`,
      overrides,
    };
  });

  return runBatchSimulation(
    {
      baseRequest: sweep.baseRequest,
      variations,
      maxConcurrency: sweep.maxConcurrency,
    },
    ctx
  );
}

/**
 * Replay a simulation by run ID
 *
 * Loads the original artifact and re-runs with the same inputs
 */
export async function replaySimulation(
  runId: string,
  ctx: ExperimentContext
): Promise<RunArtifact> {
  ctx.logger.info('[experiment.replay] loading artifact', { runId });

  // Load original artifact
  const original = await ctx.artifacts.load(runId);
  if (!original) {
    throw new NotFoundError('Run', runId, { runId });
  }

  // Extract original request
  const request = original.request as SimulationRequest;

  // Re-run with same inputs
  ctx.logger.info('[experiment.replay] re-running simulation', {
    runId,
    originalRunId: original.metadata.runId,
  });

  const artifact = await ctx.simulation.run(request);

  // Save as new run (with new run ID)
  await ctx.artifacts.save(artifact);

  ctx.logger.info('[experiment.replay] completed', {
    originalRunId: original.metadata.runId,
    newRunId: artifact.metadata.runId,
  });

  return artifact;
}

/**
 * Get git SHA (for metadata)
 */
export function getGitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get git branch (for metadata)
 */
export function getGitBranch(): string | undefined {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hash a value (SHA-256)
 */
export function hashValue(value: unknown): string {
  const str = JSON.stringify(value);
  return createHash('sha256').update(str).digest('hex');
}
