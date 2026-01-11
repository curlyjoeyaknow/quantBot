/**
 * Run ID Validator - Ensures deterministic run ID generation
 *
 * Validates that run IDs are generated deterministically and consistently.
 * Provides utilities to verify run ID integrity and detect non-deterministic generation.
 */

import { generateRunId, parseRunId, type RunIdComponents } from './run-id-manager.js';

/**
 * Validate run ID components
 *
 * Ensures all required components are present and valid.
 *
 * @param components - Run ID components to validate
 * @returns Validation result with errors if any
 */
export function validateRunIdComponents(components: RunIdComponents): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check required fields
  if (!components.command || typeof components.command !== 'string') {
    errors.push('Command is required and must be a string');
  }

  if (!components.strategyId || typeof components.strategyId !== 'string') {
    errors.push('Strategy ID is required and must be a string');
  }

  if (!components.mint || typeof components.mint !== 'string') {
    errors.push('Mint address is required and must be a string');
  }

  if (!components.alertTimestamp || typeof components.alertTimestamp !== 'string') {
    errors.push('Alert timestamp is required and must be a string (ISO 8601)');
  }

  // Validate ISO 8601 timestamp format
  if (components.alertTimestamp) {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    if (
      !isoRegex.test(components.alertTimestamp) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(components.alertTimestamp)
    ) {
      errors.push(
        'Alert timestamp must be in ISO 8601 format (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ssZ)'
      );
    }
  }

  // Validate mint address length (Solana addresses are 32-44 chars)
  if (components.mint && (components.mint.length < 32 || components.mint.length > 44)) {
    errors.push('Mint address must be between 32 and 44 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Verify run ID determinism
 *
 * Generates a run ID twice from the same components and verifies they match.
 * This ensures the run ID generation is deterministic.
 *
 * @param components - Run ID components
 * @returns True if run ID generation is deterministic
 */
export function verifyRunIdDeterminism(components: RunIdComponents): boolean {
  const runId1 = generateRunId(components);
  const runId2 = generateRunId(components);

  return runId1 === runId2;
}

/**
 * Validate a generated run ID
 *
 * Parses a run ID and validates its structure and components.
 *
 * @param runId - Run ID to validate
 * @returns Validation result with parsed components if valid
 */
export function validateRunId(runId: string): {
  valid: boolean;
  errors: string[];
  parsed?: ReturnType<typeof parseRunId>;
} {
  const errors: string[] = [];

  // Basic format check: should have at least 5 parts separated by underscores
  const parts = runId.split('_');
  if (parts.length < 5) {
    errors.push(`Run ID must have at least 5 parts separated by underscores, got ${parts.length}`);
    return { valid: false, errors };
  }

  // Parse the run ID
  const parsed = parseRunId(runId);

  // Validate parsed components
  if (!parsed.hash || !/^[a-f0-9]{8}$/.test(parsed.hash)) {
    errors.push('Run ID hash must be 8 hexadecimal characters');
  }

  if (!parsed.timestamp || !/^\d{14}$/.test(parsed.timestamp)) {
    errors.push('Run ID timestamp must be 14 digits (YYYYMMDDHHmmss)');
  }

  if (!parsed.mintShort || parsed.mintShort.length < 8) {
    errors.push('Run ID mint short must be at least 8 characters');
  }

  if (!parsed.strategyId || parsed.strategyId.length === 0) {
    errors.push('Run ID strategy ID is missing or empty');
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed: errors.length === 0 ? parsed : undefined,
  };
}

/**
 * Generate and validate run ID
 *
 * Convenience function that generates a run ID from components and validates it.
 *
 * @param components - Run ID components
 * @returns Generated run ID and validation result
 */
export function generateAndValidateRunId(components: RunIdComponents): {
  runId: string;
  valid: boolean;
  errors: string[];
} {
  // Validate components first
  const componentValidation = validateRunIdComponents(components);
  if (!componentValidation.valid) {
    return {
      runId: '',
      valid: false,
      errors: componentValidation.errors,
    };
  }

  // Generate run ID
  const runId = generateRunId(components);

  // Verify determinism
  if (!verifyRunIdDeterminism(components)) {
    return {
      runId,
      valid: false,
      errors: ['Run ID generation is not deterministic'],
    };
  }

  // Validate generated run ID
  const runIdValidation = validateRunId(runId);
  if (!runIdValidation.valid) {
    return {
      runId,
      valid: false,
      errors: runIdValidation.errors,
    };
  }

  return {
    runId,
    valid: true,
    errors: [],
  };
}
