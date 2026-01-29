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
import { validateExperimentInputs } from '../artifact-validator.js';
import { executeSimulation } from '../simulation-executor.js';
import { publishResults, type Provenance } from '../result-publisher.js';
import type { SimulationInput } from '../types.js';

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
  const { artifactStore, projectionBuilder, experimentTracker } = ports;
  const startTime = Date.now();

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
    const projectionId = `exp-${experiment.experimentId}-${Date.now()}`;
    const projection = await projectionBuilder.buildProjection({
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

    try {
      // 5. Execute simulation engine
      const simulationInput: SimulationInput = {
        duckdbPath: projection.duckdbPath,
        config: {
          strategy: experiment.config.strategy as any,
          dateRange: experiment.config.dateRange,
          params: experiment.config.params,
        },
        seed: generateSeed(experiment.experimentId),
      };

      const simulationResults = await executeSimulation(simulationInput);

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

      // 9. Dispose projection (cleanup)
      await projectionBuilder.disposeProjection(projectionId);

      // 10. Return completed experiment
      const completedExperiment = await experimentTracker.getExperiment(experiment.experimentId);
      return completedExperiment;
    } catch (error) {
      // Cleanup projection on error
      try {
        await projectionBuilder.disposeProjection(projectionId);
      } catch (cleanupError) {
        // Log cleanup error but don't mask original error
        console.error('Failed to cleanup projection:', cleanupError);
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
 * Generate deterministic seed from experiment ID
 *
 * @param experimentId - Experiment ID
 * @returns Seed value
 */
function generateSeed(experimentId: string): number {
  // Simple hash function to generate seed from experiment ID
  let hash = 0;
  for (let i = 0; i < experimentId.length; i++) {
    const char = experimentId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

