/**
 * Result Publisher
 *
 * Publishes simulation results as artifacts in the artifact store.
 *
 * @packageDocumentation
 */

import type { ArtifactStorePort } from '@quantbot/core';
import type { ExperimentResults } from '@quantbot/core';
import type { SimulationResults } from './types.js';

/**
 * Provenance information for result publishing
 */
export interface Provenance {
  /** Git commit hash */
  gitCommit: string;

  /** Whether git working directory was dirty */
  gitDirty: boolean;

  /** Engine version */
  engineVersion: string;

  /** Writer name */
  writerName: string;

  /** Writer version */
  writerVersion: string;
}

/**
 * Publish simulation results as artifacts
 *
 * Creates three artifacts:
 * 1. Trades artifact (experiment_trades)
 * 2. Metrics artifact (experiment_metrics)
 * 3. Curves artifact (experiment_curves)
 *
 * @param experimentId - Experiment ID
 * @param results - Simulation results with file paths
 * @param provenance - Provenance information
 * @param artifactStore - Artifact store port
 * @returns Experiment results with artifact IDs
 */
export async function publishResults(
  experimentId: string,
  results: SimulationResults,
  provenance: Provenance,
  artifactStore: ArtifactStorePort
): Promise<ExperimentResults> {
  // 1. Publish trades artifact
  const tradesResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_trades',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/trades`,
    dataPath: results.tradesPath,
    inputArtifactIds: results.inputArtifactIds,
    writerName: provenance.writerName,
    writerVersion: provenance.writerVersion,
    gitCommit: provenance.gitCommit,
    gitDirty: provenance.gitDirty,
    params: {
      experimentId,
      engineVersion: provenance.engineVersion,
    },
  });

  if (!tradesResult.success) {
    throw new Error(`Failed to publish trades artifact: ${tradesResult.error}`);
  }

  // 2. Publish metrics artifact
  const metricsResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_metrics',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/metrics`,
    dataPath: results.metricsPath,
    inputArtifactIds: results.inputArtifactIds,
    writerName: provenance.writerName,
    writerVersion: provenance.writerVersion,
    gitCommit: provenance.gitCommit,
    gitDirty: provenance.gitDirty,
    params: {
      experimentId,
      engineVersion: provenance.engineVersion,
    },
  });

  if (!metricsResult.success) {
    throw new Error(`Failed to publish metrics artifact: ${metricsResult.error}`);
  }

  // 3. Publish curves artifact
  const curvesResult = await artifactStore.publishArtifact({
    artifactType: 'experiment_curves',
    schemaVersion: 1,
    logicalKey: `experiment=${experimentId}/curves`,
    dataPath: results.curvesPath,
    inputArtifactIds: results.inputArtifactIds,
    writerName: provenance.writerName,
    writerVersion: provenance.writerVersion,
    gitCommit: provenance.gitCommit,
    gitDirty: provenance.gitDirty,
    params: {
      experimentId,
      engineVersion: provenance.engineVersion,
    },
  });

  if (!curvesResult.success) {
    throw new Error(`Failed to publish curves artifact: ${curvesResult.error}`);
  }

  // 4. Publish diagnostics artifact (if present)
  let diagnosticsArtifactId: string | undefined;
  if (results.diagnosticsPath) {
    const diagnosticsResult = await artifactStore.publishArtifact({
      artifactType: 'experiment_diagnostics',
      schemaVersion: 1,
      logicalKey: `experiment=${experimentId}/diagnostics`,
      dataPath: results.diagnosticsPath,
      inputArtifactIds: results.inputArtifactIds,
      writerName: provenance.writerName,
      writerVersion: provenance.writerVersion,
      gitCommit: provenance.gitCommit,
      gitDirty: provenance.gitDirty,
      params: {
        experimentId,
        engineVersion: provenance.engineVersion,
      },
    });

    if (!diagnosticsResult.success) {
      throw new Error(`Failed to publish diagnostics artifact: ${diagnosticsResult.error}`);
    }

    diagnosticsArtifactId = diagnosticsResult.deduped
      ? diagnosticsResult.existingArtifactId
      : diagnosticsResult.artifactId;
  }

  return {
    tradesArtifactId: tradesResult.deduped
      ? tradesResult.existingArtifactId
      : tradesResult.artifactId,
    metricsArtifactId: metricsResult.deduped
      ? metricsResult.existingArtifactId
      : metricsResult.artifactId,
    curvesArtifactId: curvesResult.deduped
      ? curvesResult.existingArtifactId
      : curvesResult.artifactId,
    diagnosticsArtifactId,
  };
}

