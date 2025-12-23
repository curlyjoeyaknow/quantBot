/**
 * Run ID Validator Tests
 *
 * Ensures run ID generation is deterministic and validated.
 */

import { describe, it, expect } from 'vitest';
import {
  validateRunIdComponents,
  verifyRunIdDeterminism,
  validateRunId,
  generateAndValidateRunId,
} from '../../../src/core/run-id-validator.js';
import { generateRunId, type RunIdComponents } from '../../../src/core/run-id-manager.js';

describe('validateRunIdComponents', () => {
  const validComponents: RunIdComponents = {
    command: 'simulation.run-duckdb',
    strategyId: 'PT2',
    mint: 'So11111111111111111111111111111111111111112',
    alertTimestamp: '2024-01-01T12:00:00Z',
  };

  it('should validate valid components', () => {
    const result = validateRunIdComponents(validComponents);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing command', () => {
    const result = validateRunIdComponents({
      ...validComponents,
      command: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid timestamp format', () => {
    const result = validateRunIdComponents({
      ...validComponents,
      alertTimestamp: 'invalid-date',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ISO 8601'))).toBe(true);
  });

  it('should reject invalid mint address length', () => {
    const result = validateRunIdComponents({
      ...validComponents,
      mint: 'short',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('32 and 44 characters'))).toBe(true);
  });
});

describe('verifyRunIdDeterminism', () => {
  const components: RunIdComponents = {
    command: 'simulation.run-duckdb',
    strategyId: 'PT2',
    mint: 'So11111111111111111111111111111111111111112',
    alertTimestamp: '2024-01-01T12:00:00Z',
  };

  it('should verify run ID generation is deterministic', () => {
    const isDeterministic = verifyRunIdDeterminism(components);
    expect(isDeterministic).toBe(true);
  });

  it('should generate same run ID for same components', () => {
    const runId1 = generateRunId(components);
    const runId2 = generateRunId(components);
    expect(runId1).toBe(runId2);
  });
});

describe('validateRunId', () => {
  it('should validate a properly formatted run ID', () => {
    // Generate a valid run ID using the actual generator
    const components: RunIdComponents = {
      command: 'simulation.run-duckdb',
      strategyId: 'PT2',
      mint: 'So11111111111111111111111111111111111111112',
      alertTimestamp: '2024-01-01T12:00:00Z',
    };
    const runId = generateRunId(components);
    const result = validateRunId(runId);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parsed).toBeDefined();
  });

  it('should reject run ID with too few parts', () => {
    const runId = 'simulation_PT2';
    const result = validateRunId(runId);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject run ID with invalid hash', () => {
    const runId = 'simulation_run_duckdb_PT2_So11111_20240101120000_invalid';
    const result = validateRunId(runId);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('hash'))).toBe(true);
  });
});

describe('generateAndValidateRunId', () => {
  const validComponents: RunIdComponents = {
    command: 'simulation.run-duckdb',
    strategyId: 'PT2',
    mint: 'So11111111111111111111111111111111111111112',
    alertTimestamp: '2024-01-01T12:00:00Z',
  };

  it('should generate and validate a run ID', () => {
    const result = generateAndValidateRunId(validComponents);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.runId).toBeTruthy();
  });

  it('should reject invalid components', () => {
    const result = generateAndValidateRunId({
      ...validComponents,
      mint: 'short',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
