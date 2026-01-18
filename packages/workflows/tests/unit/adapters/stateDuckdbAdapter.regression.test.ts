/**
 * Regression Tests for StatePort DuckDB Adapter
 *
 * CRITICAL: These tests prevent regression of bugs that were fixed:
 * 1. Metadata serialization bug - objects must be serialized to JSON strings
 * 2. DuckDB path bug - correct path must be used for state storage
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createStateDuckdbAdapter } from '../../../src/adapters/stateDuckdbAdapter.js';
import { getPythonEngine } from '@quantbot/infra/utils';
import { vi } from 'vitest';
import path from 'node:path';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';

describe('StatePort DuckDB Adapter - Regression Tests', () => {
  let testDbPath: string;
  let statePort: ReturnType<typeof createStateDuckdbAdapter>;

  beforeEach(() => {
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Create unique test database path
    testDbPath = path.join(dataDir, `test_state_${Date.now()}.duckdb`);
    statePort = createStateDuckdbAdapter(testDbPath);
  });

  afterEach(() => {
    // Cleanup test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('CRITICAL: should serialize objects to JSON strings before storing (prevents validation errors)', async () => {
    /**
     * REGRESSION TEST: This test would have caught the original bug.
     *
     * The original bug passed JavaScript objects directly to Python, which expected JSON strings.
     * This caused Pydantic validation errors: "Input should be a valid string [type=string_type, input_value={...}, input_type=dict]"
     *
     * If this test fails, it means objects are being passed directly again, which will cause metadata update failures.
     */
    const metadata = {
      mint: '7pXs123456789012345678901234567890pump',
      alertTimestamp: '2025-12-23T00:00:00.000Z',
      intervalSeconds: 60,
      timeRangeStart: '2025-12-22T00:00:00.000Z',
      timeRangeEnd: '2025-12-24T00:00:00.000Z',
      candleCount: 100,
      updatedAt: '2025-12-23T12:00:00.000Z',
    };

    // This should succeed (object is serialized to JSON string internally)
    const setResult = await statePort.set({
      key: 'test_metadata_key',
      namespace: 'test_namespace',
      value: metadata, // Passing object, not string
    });

    expect(setResult.success).toBe(true);
    expect(setResult.error).toBeUndefined();

    // Verify we can retrieve it back as an object
    const getResult = await statePort.get<typeof metadata>({
      key: 'test_metadata_key',
      namespace: 'test_namespace',
    });

    expect(getResult.found).toBe(true);
    expect(getResult.value).toEqual(metadata);
  }, 30000); // 30 second timeout for DuckDB operations

  it('CRITICAL: should handle string values correctly (no double-serialization)', async () => {
    /**
     * REGRESSION TEST: Ensures string values aren't double-serialized.
     *
     * If a string is passed, it should be stored as-is (not JSON.stringify'd again).
     */
    const stringValue = 'simple_string_value';

    const setResult = await statePort.set({
      key: 'test_string_key',
      namespace: 'test_namespace',
      value: stringValue,
    });

    expect(setResult.success).toBe(true);

    const getResult = await statePort.get<string>({
      key: 'test_string_key',
      namespace: 'test_namespace',
    });

    expect(getResult.found).toBe(true);
    expect(getResult.value).toBe(stringValue);
  });

  it('CRITICAL: should use the correct DuckDB path (prevents file not found errors)', async () => {
    /**
     * REGRESSION TEST: This test would have caught the original bug.
     *
     * The original bug used a default path ('data/tele.duckdb') instead of the path
     * specified in the workflow spec. This caused "Cannot open file" errors.
     *
     * If this test fails, it means the adapter is using the wrong path.
     */
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    const customDbPath = path.join(dataDir, `custom_test_${Date.now()}.duckdb`);
    const customStatePort = createStateDuckdbAdapter(customDbPath);

    try {
      // Should succeed with custom path
      const setResult = await customStatePort.set({
        key: 'test_key',
        namespace: 'test_namespace',
        value: { test: 'data' },
      });

      expect(setResult.success).toBe(true);

      // Verify file was created at correct path
      expect(existsSync(customDbPath)).toBe(true);

      // Verify we can read from it
      const getResult = await customStatePort.get({
        key: 'test_key',
        namespace: 'test_namespace',
      });

      expect(getResult.found).toBe(true);
    } finally {
      // Cleanup
      if (existsSync(customDbPath)) {
        unlinkSync(customDbPath);
      }
    }
  });

  it('CRITICAL: should deserialize JSON strings back to objects when reading', async () => {
    /**
     * REGRESSION TEST: Ensures JSON strings are parsed back to objects.
     *
     * Python stores values as JSON strings, but TypeScript expects objects.
     * The adapter must deserialize on read.
     */
    const complexObject = {
      mint: '7pXs123456789012345678901234567890pump',
      metadata: {
        chain: 'solana',
        symbol: 'TEST',
        decimals: 9,
      },
      timestamps: ['2025-12-23T00:00:00.000Z', '2025-12-23T01:00:00.000Z'],
      counts: [1, 2, 3],
    };

    const setResult = await statePort.set({
      key: 'complex_object_key',
      namespace: 'test_namespace',
      value: complexObject,
    });

    expect(setResult.success).toBe(true);

    const getResult = await statePort.get<typeof complexObject>({
      key: 'complex_object_key',
      namespace: 'test_namespace',
    });

    expect(getResult.found).toBe(true);
    expect(getResult.value).toEqual(complexObject);
    expect(typeof getResult.value).toBe('object');
    expect(Array.isArray(getResult.value?.timestamps)).toBe(true);
  });
});
