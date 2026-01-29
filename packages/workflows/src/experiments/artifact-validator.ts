/**
 * Artifact Validator
 *
 * Validates that all input artifacts exist and are in 'active' status.
 *
 * @packageDocumentation
 */

import type { ArtifactStorePort } from '@quantbot/core';
import type { ValidationResult, ValidationError } from './types.js';
import { resolve } from 'node:path';

/**
 * Validate artifact path for security (prevent path traversal)
 *
 * @param path - Path to validate
 * @param allowedBase - Base directory that path must be within
 * @returns True if path is valid
 */
function validateArtifactPath(path: string, allowedBase?: string): boolean {
  if (!path || path.length === 0) {
    return false;
  }

  // Check for path traversal attempts
  if (path.includes('..') || path.includes('~')) {
    return false;
  }

  // If allowedBase is provided, ensure path is within it
  if (allowedBase) {
    try {
      const resolvedPath = resolve(path);
      const resolvedBase = resolve(allowedBase);
      if (!resolvedPath.startsWith(resolvedBase)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Validate all input artifacts
 *
 * Checks that:
 * 1. All artifacts exist
 * 2. All artifacts have status 'active'
 * 3. Artifact paths are valid (no path traversal)
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
    // Validate artifact ID format (basic security check)
    if (!artifactId || artifactId.length === 0 || artifactId.length > 500) {
      errors.push({
        artifactId,
        message: 'Invalid artifact ID format',
        type: 'invalid_schema',
      });
      continue;
    }

    // Check for suspicious characters in artifact ID
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1f]/.test(artifactId)) {
      errors.push({
        artifactId,
        message: 'Artifact ID contains invalid characters',
        type: 'invalid_schema',
      });
      continue;
    }

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

      // Validate artifact paths (if present)
      if (artifact.pathParquet && !validateArtifactPath(artifact.pathParquet)) {
        errors.push({
          artifactId,
          message: 'Artifact Parquet path contains invalid characters or path traversal',
          type: 'invalid_schema',
        });
      }

      if (artifact.pathSidecar && !validateArtifactPath(artifact.pathSidecar)) {
        errors.push({
          artifactId,
          message: 'Artifact sidecar path contains invalid characters or path traversal',
          type: 'invalid_schema',
        });
      }
    } catch (error) {
      // Artifact not found
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Note: Logging removed for handler purity - errors are returned in ValidationResult
      errors.push({
        artifactId,
        message: errorMessage,
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
