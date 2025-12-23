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

  /**
   * Early-abort configuration
   * If provided, batch will stop early if criteria are met
   */
  earlyAbort?: EarlyAbortConfig;
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

  /**
   * Whether the batch was aborted early
   */
  aborted?: {
    reason: string;
    afterRuns: number;
    metrics: {
      winRate?: number;
      avgReturn?: number;
      maxDrawdown?: number;
      profitableRuns?: number;
    };
  };
}

/**
 * Check early-abort criteria
 */
function checkEarlyAbort(
  config: EarlyAbortConfig,
  completedRuns: number,
  artifacts: RunArtifact[]
): { shouldAbort: boolean; reason?: string; metrics?: Record<string, number> } {
  if (completedRuns === 0) {
    return { shouldAbort: false };
  }

  const metrics: Record<string, number> = {};

  // Calculate aggregate metrics
  const returns = artifacts.map((a) => a.metrics.return.total);
  const drawdowns = artifacts.map((a) => a.metrics.drawdown.max);
  const winRates = artifacts.map((a) => a.metrics.hitRate.overall);
  const profitableRuns = artifacts.filter((a) => a.metrics.return.total > 1.0).length;

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const maxDrawdown = Math.max(...drawdowns);
  const avgWinRate = winRates.reduce((sum, r) => sum + r, 0) / winRates.length;

  metrics.avgReturn = avgReturn;
  metrics.maxDrawdown = maxDrawdown;
  metrics.winRate = avgWinRate;
  metrics.profitableRuns = profitableRuns;

  // Check min win rate
  if (config.minWinRate && completedRuns >= config.minWinRate.afterRuns) {
    if (avgWinRate < config.minWinRate.threshold) {
      return {
        shouldAbort: true,
        reason: `Win rate ${avgWinRate.toFixed(3)} below threshold ${config.minWinRate.threshold} after ${completedRuns} runs`,
        metrics,
      };
    }
  }

  // Check min average return
  if (config.minAvgReturn && completedRuns >= config.minAvgReturn.afterRuns) {
    if (avgReturn < config.minAvgReturn.threshold) {
      return {
        shouldAbort: true,
        reason: `Average return ${avgReturn.toFixed(3)} below threshold ${config.minAvgReturn.threshold} after ${completedRuns} runs`,
        metrics,
      };
    }
  }

  // Check max drawdown
  if (config.maxDrawdown && completedRuns >= config.maxDrawdown.afterRuns) {
    if (maxDrawdown > config.maxDrawdown.threshold) {
      return {
        shouldAbort: true,
        reason: `Max drawdown ${maxDrawdown.toFixed(3)} exceeds threshold ${config.maxDrawdown.threshold} after ${completedRuns} runs`,
        metrics,
      };
    }
  }

  // Check min profitable runs
  if (config.minProfitableRuns && completedRuns >= config.minProfitableRuns.afterRuns) {
    if (profitableRuns < config.minProfitableRuns.count) {
      return {
        shouldAbort: true,
        reason: `Only ${profitableRuns} profitable runs (required ${config.minProfitableRuns.count}) after ${completedRuns} runs`,
        metrics,
      };
    }
  }

  return { shouldAbort: false, metrics };
}

export async function runBatchSimulation(
  batch: BatchSimulationRequest,
  ctx: ExperimentContext = createExperimentContext()
): Promise<BatchSimulationResult> {
  const maxConcurrency = batch.maxConcurrency ?? 4;
  const runIds: string[] = [];
  const successful: string[] = [];
  const failed: Array<{ variationId: string; runId?: string; error: string }> = [];
  const artifacts: RunArtifact[] = [];

  ctx.logger.info('[experiment.runBatch] starting', {
    variations: batch.variations.length,
    maxConcurrency,
    earlyAbort: batch.earlyAbort ? 'enabled' : 'disabled',
  });

  // Process in batches
  for (let i = 0; i < batch.variations.length; i += maxConcurrency) {
    const batchSlice = batch.variations.slice(i, i + maxConcurrency);

    const promises = batchSlice.map(async (variation) => {
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
            // Make seed deterministic from variation ID
            seed:
              variation.overrides.runConfig?.seed ??
              seedFromVariationId(variation.variationId, batch.baseRequest.runConfig.seed),
          },
        };

        const artifact = await ctx.simulation.run(request);
        await ctx.artifacts.save(artifact);

        const runId = artifact.metadata.runId;
        runIds.push(runId);
        successful.push(runId);
        artifacts.push(artifact);

        if (ctx.logger.debug) {
          ctx.logger.debug('[experiment.runBatch] variation completed', {
            variationId: variation.variationId,
            runId,
          });
        }

        return artifact;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const runId = ctx.ids.newRunId(); // Generate run ID even for failures
        runIds.push(runId);
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
        return null;
      }
    });

    const batchResults = await Promise.all(promises);
    const completedArtifacts = batchResults.filter((a): a is RunArtifact => a !== null);
    artifacts.push(...completedArtifacts);

    // Check early-abort criteria after each batch
    if (batch.earlyAbort && artifacts.length > 0) {
      const abortCheck = checkEarlyAbort(batch.earlyAbort, artifacts.length, artifacts);
      if (abortCheck.shouldAbort) {
        ctx.logger.warn('[experiment.runBatch] early abort triggered', {
          reason: abortCheck.reason,
          completedRuns: artifacts.length,
          totalVariations: batch.variations.length,
          metrics: abortCheck.metrics,
        });

        return {
          runIds,
          successful,
          failed,
          aborted: {
            reason: abortCheck.reason!,
            afterRuns: artifacts.length,
            metrics: abortCheck.metrics || {},
          },
        };
      }
    }
  }

  ctx.logger.info('[experiment.runBatch] completed', {
    total: batch.variations.length,
    successful: successful.length,
    failed: failed.length,
    aborted: false,
  });

  return { runIds, successful, failed };
}

/**
 * Early-abort configuration
 *
 * Allows sweep runners to stop early if strategy is clearly failing
 */
export interface EarlyAbortConfig {
  /**
   * Stop if win rate below threshold after N runs
   */
  minWinRate?: {
    /** Minimum win rate threshold (0-1) */
    threshold: number;
    /** Number of runs to evaluate before checking */
    afterRuns: number;
  };

  /**
   * Stop if average return below threshold after N runs
   */
  minAvgReturn?: {
    /** Minimum average return threshold (as multiplier, e.g., 0.95 = -5%) */
    threshold: number;
    /** Number of runs to evaluate before checking */
    afterRuns: number;
  };

  /**
   * Stop if max drawdown exceeds threshold
   */
  maxDrawdown?: {
    /** Maximum drawdown threshold (as fraction, e.g., 0.2 = -20%) */
    threshold: number;
    /** Number of runs to evaluate before checking */
    afterRuns: number;
  };

  /**
   * Stop if no profitable runs after N attempts
   */
  minProfitableRuns?: {
    /** Minimum number of profitable runs required */
    count: number;
    /** Number of runs to evaluate before checking */
    afterRuns: number;
  };
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

  /**
   * Early-abort configuration
   * If provided, sweep will stop early if criteria are met
   */
  earlyAbort?: EarlyAbortConfig;
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
 *
 * Deterministic: Same parameters → same order of combinations
 */
function generateParameterCombinations(
  parameters: ParameterSweepRequest['parameters']
): Array<Record<string, unknown>> {
  if (parameters.length === 0) return [{}];

  const [first, ...rest] = parameters;
  if (!first) return [{}];

  const restCombinations = generateParameterCombinations(rest);

  const combinations: Array<Record<string, unknown>> = [];

  // Sort values for determinism (if they're comparable)
  const sortedValues = [...first.values].sort((a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    return String(a).localeCompare(String(b));
  });

  for (const value of sortedValues) {
    for (const restCombo of restCombinations) {
      combinations.push({
        [first.path]: value,
        ...restCombo,
      });
    }
  }

  return combinations;
}

/**
 * Generate deterministic seed from variation ID
 *
 * Same variation ID → same seed
 */
function seedFromVariationId(variationId: string, baseSeed: number): number {
  // Hash variation ID to get a deterministic offset
  const hash = hashValue(variationId);
  // Use first 8 hex chars as offset (max 2^32)
  const offset = parseInt(hash.substring(0, 8), 16) % 1_000_000;
  return baseSeed + offset;
}

export async function runParameterSweep(
  sweep: ParameterSweepRequest,
  ctx: ExperimentContext = createExperimentContext()
): Promise<BatchSimulationResult> {
  // Generate all parameter combinations (deterministic order)
  const combinations = generateParameterCombinations(sweep.parameters);

  ctx.logger.info('[experiment.runSweep] generated combinations', {
    total: combinations.length,
    parameters: sweep.parameters.length,
  });

  // Convert to batch format with deterministic variation IDs
  const variations = combinations.map((combo, index) => {
    const overrides: Partial<SimulationRequest> = {};

    // Apply each parameter
    for (const [path, value] of Object.entries(combo)) {
      setNestedProperty(overrides, path, value);
    }

    // Create deterministic variation ID from parameter combination
    const comboHash = hashValue(combo);
    const variationId = `sweep-${comboHash.substring(0, 8)}-${index}`;

    return {
      variationId,
      overrides,
    };
  });

  return runBatchSimulation(
    {
      baseRequest: sweep.baseRequest,
      variations,
      maxConcurrency: sweep.maxConcurrency,
      earlyAbort: sweep.earlyAbort,
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
