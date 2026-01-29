/**
 * Execute Experiment Handler
 *
 * Pure handler that orchestrates experiment execution.
 * Depends on ports only (not adapters).
 *
 * Execution flow:
 * 1. Create experiment record (pending)
 * 2. Update status to running
 * 3. Validate all input artifacts exist
 * 4. Build DuckDB projection from artifacts
 * 5. Execute simulation engine
 * 6. Publish results as artifacts (trades, metrics)
 * 7. Store output artifact IDs
 * 8. Update status to completed
 * 9. Dispose projection (cleanup)
 * 10. Return completed experiment
 *
 * @packageDocumentation
 */

import type {
  ArtifactStorePort,
  ProjectionBuilderPort,
  ExperimentTrackerPort,
  ExperimentDefinition,
  Experiment,
} from '@quantbot/core';
import type { SimulationService } from '@quantbot/simulation';
import { validateExperimentInputs } from '../artifact-validator.js';
import { executeSimulation } from '../simulation-executor.js';
import { publishResults, type Provenance } from '../result-publisher.js';
import type { SimulationInput } from '../types.js';
import { createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * Ports required for experiment execution
 */
export interface ExperimentExecutionPorts {
  /** Artifact store port */
  artifactStore: ArtifactStorePort;

  /** Projection builder port */
  projectionBuilder: ProjectionBuilderPort;

  /** Experiment tracker port */
  experimentTracker: ExperimentTrackerPort;

  /** Simulation service (Python-based) */
  simulationService: SimulationService;
}

/**
 * Execute experiment with frozen artifact sets
 *
 * This is a pure handler that depends on ports only.
 * All I/O is performed through ports.
 *
 * @param definition - Experiment definition
 * @param ports - Required ports
 * @returns Completed experiment record
 * @throws Error if execution fails
 */
export async function executeExperiment(
  definition: ExperimentDefinition,
  ports: ExperimentExecutionPorts
): Promise<Experiment> {
  const { artifactStore, projectionBuilder, experimentTracker, simulationService } = ports;

  // 0. Validate experiment definition
  // Validate alerts are not empty
  if (!definition.inputs.alerts || definition.inputs.alerts.length === 0) {
    throw new Error('Experiment must have at least one alert');
  }

  // Validate date range
  if (!definition.config.dateRange?.from || !definition.config.dateRange?.to) {
    throw new Error('Experiment must have a valid date range');
  }

  const fromDate = new Date(definition.config.dateRange.from);
  const toDate = new Date(definition.config.dateRange.to);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    throw new Error('Invalid date range: dates must be valid ISO strings');
  }

  if (fromDate >= toDate) {
    throw new Error('Invalid date range: from date must be before to date');
  }

  // Validate exit targets exist
  const exitConfig = definition.config.strategy?.exit;
  if (
    !exitConfig ||
    typeof exitConfig !== 'object' ||
    !('targets' in exitConfig) ||
    !Array.isArray(exitConfig.targets) ||
    exitConfig.targets.length === 0
  ) {
    throw new Error('Exit targets are required');
  }

  // 1. Create experiment record (pending)
  const experiment = await experimentTracker.createExperiment(definition);

  try {
    // 2. Update status to running
    await experimentTracker.updateStatus(experiment.experimentId, 'running');

    // 3. Validate all input artifacts exist
    const validation = await validateExperimentInputs(experiment.inputs, artifactStore);
    if (!validation.valid) {
      const errorMessages = validation.errors.map((e) => `${e.artifactId}: ${e.message}`);
      throw new Error(`Artifact validation failed:\n${errorMessages.join('\n')}`);
    }

    // 4. Build DuckDB projection from artifacts
    // Use UUID-based projection ID to avoid collisions
    const projectionId = `exp-${experiment.experimentId}-${uuidv4()}`;

    // Retry projection building for transient failures (e.g., DuckDB locks)
    let projection;
    let retries = 3;
    let lastError: Error | undefined;

    while (retries > 0) {
      try {
        projection = await projectionBuilder.buildProjection({
          projectionId,
          artifacts: {
            alerts: experiment.inputs.alerts,
            ohlcv: experiment.inputs.ohlcv,
          },
          tables: {
            alerts: 'alerts',
            ohlcv: 'ohlcv',
          },
          indexes: [
            { table: 'alerts', columns: ['timestamp'] },
            { table: 'ohlcv', columns: ['timestamp'] },
          ],
        });
        break; // Success
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries--;

        // Check if error is transient (e.g., lock timeout)
        const isTransient =
          lastError.message.includes('lock') ||
          lastError.message.includes('timeout') ||
          lastError.message.includes('busy');

        if (!isTransient || retries === 0) {
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        const delayMs = (4 - retries) * 100; // 100ms, 200ms, 300ms
        // Note: Logging removed for handler purity - retry logic continues silently
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    if (!projection) {
      throw lastError || new Error('Failed to build projection after retries');
    }

    try {
      // 5. Execute simulation engine
      // Validate and extract strategy config safely
      const strategyConfig = experiment.config.strategy;
      if (!strategyConfig || typeof strategyConfig !== 'object') {
        throw new Error('Invalid strategy configuration: must be an object');
      }

      // Validate date range
      const dateRange = experiment.config.dateRange;
      if (
        !dateRange ||
        typeof dateRange !== 'object' ||
        !('from' in dateRange) ||
        !('to' in dateRange)
      ) {
        throw new Error('Invalid date range: must have from and to properties');
      }
      if (typeof dateRange.from !== 'string' || typeof dateRange.to !== 'string') {
        throw new Error('Invalid date range: from and to must be strings');
      }

      const simulationInput: SimulationInput = {
        duckdbPath: projection.duckdbPath,
        config: {
          strategy: {
            name: 'default',
            ...strategyConfig,
          },
          dateRange: {
            from: dateRange.from,
            to: dateRange.to,
          },
          params: experiment.config.params || {},
        },
        seed: generateSeed(experiment.experimentId),
      };

      const simulationResults = await executeSimulation(simulationInput, simulationService);

      // Add input artifact IDs for lineage
      simulationResults.inputArtifactIds = [
        ...experiment.inputs.alerts,
        ...experiment.inputs.ohlcv,
        ...(experiment.inputs.strategies ?? []),
      ];

      // 6. Publish results as artifacts
      const provenance: Provenance = {
        gitCommit: experiment.provenance.gitCommit,
        gitDirty: experiment.provenance.gitDirty,
        engineVersion: experiment.provenance.engineVersion,
        writerName: 'experiment-executor',
        writerVersion: '1.0.0',
      };

      const outputArtifacts = await publishResults(
        experiment.experimentId,
        simulationResults,
        provenance,
        artifactStore
      );

      // 7. Store output artifact IDs
      await experimentTracker.storeResults(experiment.experimentId, outputArtifacts);

      // 8. Update status to completed
      await experimentTracker.updateStatus(experiment.experimentId, 'completed');

      // 9. Dispose projection (cleanup) - don't fail experiment if cleanup fails
      try {
        await projectionBuilder.disposeProjection(projectionId);
      } catch {
        // Cleanup errors are ignored - experiment succeeded, cleanup failure is non-critical
        // Note: Logging removed for handler purity - cleanup errors are silently ignored
      }

      // 10. Return completed experiment
      const completedExperiment = await experimentTracker.getExperiment(experiment.experimentId);
      return completedExperiment;
    } catch (error) {
      // Cleanup projection on error
      try {
        await projectionBuilder.disposeProjection(projectionId);
      } catch {
        // Cleanup errors are ignored - original error is re-thrown
        // Note: Logging removed for handler purity - cleanup errors are silently ignored
      }
      throw error;
    }
  } catch (error) {
    // Update status to failed
    await experimentTracker.updateStatus(experiment.experimentId, 'failed');

    // Re-throw error
    throw error;
  }
}

/**
 * Generate deterministic seed from experiment ID using cryptographic hash
 *
 * @param experimentId - Experiment ID
 * @returns Seed value (32-bit integer)
 */
function generateSeed(experimentId: string): number {
  // Use SHA-256 hash for better distribution and collision resistance
  const hash = createHash('sha256').update(experimentId).digest();
  // Extract first 4 bytes and convert to signed 32-bit integer
  const seed = hash.readUInt32BE(0);
  // Ensure positive value
  return seed >>> 0; // Convert to unsigned, then ensure positive
}
