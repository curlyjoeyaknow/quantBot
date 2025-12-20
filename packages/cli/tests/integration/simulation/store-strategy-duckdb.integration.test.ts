/**
 * Integration Tests for store-strategy-duckdb Handler
 *
 * Uses REAL implementations:
 * - Real PythonEngine (calls actual Python scripts)
 * - Real DuckDB files (created and verified)
 * - Real DuckDBStorageService
 *
 * This tests the actual integration boundaries, not just mocks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { storeStrategyDuckdbHandler } from '../../../src/handlers/simulation/store-strategy-duckdb.js';
import { getPythonEngine } from '@quantbot/utils';
import { DuckDBStorageService } from '@quantbot/simulation';
import { createCommandContext } from '../../../src/core/command-context.js';
import type { PythonEngine } from '@quantbot/utils';
import type { CommandContext } from '../../../src/core/command-context.js';
import { tmpdir } from 'os';

describe('storeStrategyDuckdbHandler - Integration Tests', () => {
  let pythonEngine: PythonEngine;
  let testDbPath: string;
  let ctx: CommandContext;

  beforeAll(() => {
    pythonEngine = getPythonEngine();
    // Use temp directory to avoid permission issues
    const tempDir = join(tmpdir(), 'quantbot-test-store-strategy');
    mkdirSync(tempDir, { recursive: true });
    // Use absolute path (Python scripts run from different working directories)
    testDbPath = resolve(tempDir, `test_store_strategy_${Date.now()}.duckdb`);

    // Create context with real PythonEngine - DuckDBStorageService will use it automatically
    ctx = createCommandContext({
      pythonEngineOverride: pythonEngine,
    });
  });

  afterAll(() => {
    // Cleanup test DuckDB
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('stores strategy in real DuckDB and verifies it exists', async () => {
    const args = {
      duckdb: testDbPath,
      strategyId: 'PT2_SL25',
      name: 'PT2 SL25',
      entryConfig: { type: 'immediate' },
      exitConfig: { targets: [{ target: 2.0, percent: 0.5 }] },
      reentryConfig: undefined,
      costConfig: undefined,
      format: 'table' as const,
    };

    // Store the strategy using real DuckDB
    const result = await storeStrategyDuckdbHandler(args, ctx);

    // Verify storage succeeded
    expect(result.success).toBe(true);
    expect(result.strategy_id).toBe('PT2_SL25');

    // Verify DuckDB file was created
    expect(existsSync(testDbPath)).toBe(true);
  });

  it('stores strategy with all optional configs in real DuckDB', async () => {
    const args = {
      duckdb: testDbPath,
      strategyId: 'PT3_SL30',
      name: 'PT3 SL30',
      entryConfig: { type: 'immediate' },
      exitConfig: { targets: [{ target: 3.0, percent: 0.5 }] },
      reentryConfig: { enabled: true, maxReentries: 2 },
      costConfig: { maker_fee: 0.001, taker_fee: 0.002 },
      format: 'table' as const,
    };

    const result = await storeStrategyDuckdbHandler(args, ctx);

    expect(result.success).toBe(true);
    expect(result.strategy_id).toBe('PT3_SL30');
  });

  it('handles duplicate strategy storage (idempotency)', async () => {
    const args = {
      duckdb: testDbPath,
      strategyId: 'DUPLICATE_TEST',
      name: 'Duplicate Test',
      entryConfig: { type: 'immediate' },
      exitConfig: { targets: [] },
      reentryConfig: undefined,
      costConfig: undefined,
      format: 'table' as const,
    };

    // Store first time
    const result1 = await storeStrategyDuckdbHandler(args, ctx);
    expect(result1.success).toBe(true);

    // Store again (should be idempotent)
    const result2 = await storeStrategyDuckdbHandler(args, ctx);
    expect(result2.success).toBe(true);
    expect(result2.strategy_id).toBe('DUPLICATE_TEST');
  });

  it('propagates errors from Python script correctly', async () => {
    const invalidArgs = {
      duckdb: '/nonexistent/path/to/db.duckdb',
      strategyId: 'ERROR_TEST',
      name: 'Error Test',
      entryConfig: {},
      exitConfig: {},
      reentryConfig: undefined,
      costConfig: undefined,
      format: 'table' as const,
    };

    // Should handle error gracefully (service catches and returns error in result)
    const result = await storeStrategyDuckdbHandler(invalidArgs, ctx);

    // Service should return error in result, not throw
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
