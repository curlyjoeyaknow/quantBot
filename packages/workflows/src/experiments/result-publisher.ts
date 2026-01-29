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
 * Publish simulation results as artifacts with transaction semantics
 *
 * Creates artifacts in order and tracks them for rollback on failure.
 * If any artifact publishing fails, attempts to clean up already-published artifacts.
 *
 * Creates artifacts:
 * 1. Trades artifact (experiment_trades)
 * 2. Metrics artifact (experiment_metrics)
 * 3. Curves artifact (experiment_curves)
 * 4. Diagnostics artifact (experiment_diagnostics, optional)
 *
 * @param experimentId - Experiment ID
 * @param results - Simulation results with file paths
 * @param provenance - Provenance information
 * @param artifactStore - Artifact store port
 * @returns Experiment results with artifact IDs
 * @throws Error if publishing fails (with cleanup attempt)
 */
export async function publishResults(
  experimentId: string,
  results: SimulationResults,
  provenance: Provenance,
  artifactStore: ArtifactStorePort
): Promise<ExperimentResults> {
  const publishedArtifacts: Array<{ artifactId: string; type: string }> = [];

  try {
    // Note: Logging removed for handler purity

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

    const tradesArtifactId = tradesResult.deduped
      ? tradesResult.existingArtifactId
      : tradesResult.artifactId;
    if (tradesArtifactId) {
      publishedArtifacts.push({ artifactId: tradesArtifactId, type: 'trades' });
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

    const metricsArtifactId = metricsResult.deduped
      ? metricsResult.existingArtifactId
      : metricsResult.artifactId;
    if (metricsArtifactId) {
      publishedArtifacts.push({ artifactId: metricsArtifactId, type: 'metrics' });
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

    const curvesArtifactId = curvesResult.deduped
      ? curvesResult.existingArtifactId
      : curvesResult.artifactId;
    if (curvesArtifactId) {
      publishedArtifacts.push({ artifactId: curvesArtifactId, type: 'curves' });
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
      if (diagnosticsArtifactId) {
        publishedArtifacts.push({ artifactId: diagnosticsArtifactId, type: 'diagnostics' });
      }
    }

    // Note: Logging removed for handler purity

    return {
      tradesArtifactId,
      metricsArtifactId,
      curvesArtifactId,
      diagnosticsArtifactId,
    };
  } catch (error) {
    // Attempt to clean up published artifacts (best-effort rollback)
    // Note: Logging removed for handler purity - cleanup happens silently

    // Attempt to supersede published artifacts (mark as superseded)
    // Note: This is best-effort - if cleanup fails, artifacts remain orphaned
    for (const artifact of publishedArtifacts) {
      try {
        await artifactStore.supersede(artifact.artifactId, 'experiment-publishing-failed');
        // Note: Logging removed for handler purity
      } catch {
        // Cleanup errors are ignored - original error is re-thrown
        // Note: Logging removed for handler purity
      }
    }

    throw error;
  }
}
