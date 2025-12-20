/**
 * Integration Tests for store-run-duckdb Handler
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
import { storeRunDuckdbHandler } from '../../../src/handlers/simulation/store-run-duckdb.js';
import { getPythonEngine } from '@quantbot/utils';
import { DuckDBStorageService } from '@quantbot/simulation';
import { createCommandContext } from '../../../src/core/command-context.js';
import type { PythonEngine } from '@quantbot/utils';
import type { CommandContext } from '../../../src/core/command-context.js';
import { tmpdir } from 'os';

describe('storeRunDuckdbHandler - Integration Tests', () => {
  let pythonEngine: PythonEngine;
  let testDbPath: string;
  let ctx: CommandContext;

  beforeAll(() => {
    pythonEngine = getPythonEngine();
    // Use temp directory to avoid permission issues
    const tempDir = join(tmpdir(), 'quantbot-test-store-run');
    mkdirSync(tempDir, { recursive: true });
    // Use absolute path (Python scripts run from different working directories)
    testDbPath = resolve(tempDir, `test_store_run_${Date.now()}.duckdb`);

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

  it('stores simulation run in real DuckDB and verifies it exists', async () => {
    // First store a strategy (like the bridge test does)
    const storageService = new DuckDBStorageService(pythonEngine);
    const strategyResult = await storageService.storeStrategy(
      testDbPath,
      'PT2_SL25',
      'PT2 SL25',
      { type: 'immediate' },
      { targets: [{ target: 2.0, percent: 0.5 }] }
    );
    expect(strategyResult.success).toBe(true);

    const args = {
      duckdb: testDbPath,
      runId: 'test_run_123',
      strategyId: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alertTimestamp: '2024-01-01T12:00:00', // Match bridge test format (no Z)
      startTime: '2024-01-01T12:00:00',
      endTime: '2024-01-02T12:00:00',
      initialCapital: 1000.0,
      finalCapital: 1200.0,
      totalReturnPct: 20.0,
      maxDrawdownPct: 5.0,
      sharpeRatio: 1.5,
      winRate: 0.6,
      totalTrades: 10,
      format: 'table' as const,
    };

    // Store the run using real DuckDB
    const result = await storeRunDuckdbHandler(args, ctx);

    // Verify storage succeeded
    expect(result.success).toBe(true);
    expect(result.run_id).toBe('test_run_123');

    // Verify DuckDB file was created
    expect(existsSync(testDbPath)).toBe(true);
  });

  it('handles optional fields correctly with real DuckDB', async () => {
    // Strategy already stored in previous test
    const args = {
      duckdb: testDbPath,
      runId: 'test_run_456',
      strategyId: 'PT2_SL25',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      alertTimestamp: '2024-01-02T12:00:00', // Match bridge test format
      startTime: '2024-01-02T12:00:00',
      endTime: '2024-01-03T12:00:00',
      initialCapital: 1000.0,
      // Optional fields omitted
      format: 'table' as const,
    };

    const result = await storeRunDuckdbHandler(args, ctx);

    expect(result.success).toBe(true);
    expect(result.run_id).toBe('test_run_456');
  });

  it('propagates errors from Python script correctly', async () => {
    const invalidArgs = {
      duckdb: '/nonexistent/path/to/db.duckdb',
      runId: 'test_run_error',
      strategyId: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alertTimestamp: '2024-01-01T12:00:00Z',
      startTime: '2024-01-01T12:00:00Z',
      endTime: '2024-01-02T12:00:00Z',
      initialCapital: 1000.0,
      format: 'table' as const,
    };

    // Should handle error gracefully (service catches and returns error in result)
    const result = await storeRunDuckdbHandler(invalidArgs, ctx);

    // Service should return error in result, not throw
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
