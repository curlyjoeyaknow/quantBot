/**
 * Artifact Validator
 *
 * Validates that all input artifacts exist and are in 'active' status.
 *
 * @packageDocumentation
 */

import type { ArtifactStorePort } from '@quantbot/core';
import type { ValidationResult, ValidationError } from './types.js';

/**
 * Validate all input artifacts
 *
 * Checks that:
 * 1. All artifacts exist
 * 2. All artifacts have status 'active'
 *
 * @param artifactIds - Array of artifact IDs to validate
 * @param artifactStore - Artifact store port
 * @returns Validation result with errors
 */
export async function validateArtifacts(
  artifactIds: string[],
  artifactStore: ArtifactStorePort
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  // Validate each artifact
  for (const artifactId of artifactIds) {
    try {
      const artifact = await artifactStore.getArtifact(artifactId);

      // Check status
      if (artifact.status !== 'active') {
        errors.push({
          artifactId,
          message: `Artifact has status '${artifact.status}', expected 'active'`,
          type: 'invalid_status',
        });
      }
    } catch (error) {
      // Artifact not found
      errors.push({
        artifactId,
        message: error instanceof Error ? error.message : String(error),
        type: 'not_found',
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate experiment input artifacts
 *
 * Validates all artifacts in experiment inputs (alerts, ohlcv, strategies).
 *
 * @param inputs - Experiment inputs
 * @param artifactStore - Artifact store port
 * @returns Validation result with errors
 */
export async function validateExperimentInputs(
  inputs: {
    alerts: string[];
    ohlcv: string[];
    strategies?: string[];
  },
  artifactStore: ArtifactStorePort
): Promise<ValidationResult> {
  // Collect all artifact IDs
  const allArtifactIds = [...inputs.alerts, ...inputs.ohlcv, ...(inputs.strategies ?? [])];

  // Validate all artifacts
  return validateArtifacts(allArtifactIds, artifactStore);
}
