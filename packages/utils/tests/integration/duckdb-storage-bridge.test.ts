/**
 * Bridge Test: DuckDB Storage Service
 *
 * Contract test that ensures the TypeScript/Python boundary works correctly
 * for DuckDB storage operations.
 *
 * This tests:
 * - Python tool executes successfully
 * - Output JSON matches expected schema
 * - Integration boundary works
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { PythonEngine } from '../../src/python/python-engine';
// Import directly from source to avoid package resolution issues in tests
import { DuckDBStorageService, CallsQueryResultSchema, OhlcvMetadataResultSchema, OhlcvExclusionResultSchema } from '../../../simulation/src/duckdb-storage-service';
import { getPythonEngine } from '../../src/index';

describe('DuckDB Storage Bridge Test', () => {
  let pythonEngine: PythonEngine;
  let storageService: DuckDBStorageService;
  let testDbPath: string;

  beforeAll(() => {
    pythonEngine = getPythonEngine();
    storageService = new DuckDBStorageService(pythonEngine);
    
    // Create temporary DuckDB file
    testDbPath = join(process.cwd(), 'test_storage.duckdb');
  });

  afterAll(() => {
    // Cleanup
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  it('stores strategy and validates output schema', async () => {
    const result = await storageService.storeStrategy(
      testDbPath,
      'PT2_SL25',
      'PT2 SL25',
      { type: 'immediate' },
      { targets: [{ target: 2.0, percent: 0.5 }] }
    );

    expect(result.success).toBe(true);
    expect(result.strategy_id).toBe('PT2_SL25');
    expect(result.error).toBeUndefined();
  });

  it('stores simulation run and validates output schema', async () => {
    const result = await storageService.storeRun(
      testDbPath,
      'run_123',
      'PT2_SL25',
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      '2024-01-01T12:00:00',
      '2024-01-02T12:00:00',
      1000.0,
      1200.0,
      20.0
    );

    expect(result.success).toBe(true);
    expect(result.run_id).toBe('run_123');
    expect(result.error).toBeUndefined();
  });

  it('queries calls and validates output schema', async () => {
    // First, ensure we have a DuckDB with calls table
    // (This would normally be set up by ingestion)
    
    const result = await storageService.queryCalls(testDbPath, 10);

    expect(result.success).toBe(true);
    // May or may not have calls, but structure should be correct
    if (result.calls) {
      expect(Array.isArray(result.calls)).toBe(true);
      result.calls.forEach((call) => {
        expect(call.mint).toBeDefined();
        expect(call.alert_timestamp).toBeDefined();
        expect(typeof call.mint).toBe('string');
        expect(typeof call.alert_timestamp).toBe('string');
      });
    }
  });

  it('updates OHLCV metadata and validates output schema', async () => {
    const result = await storageService.updateOhlcvMetadata(
      testDbPath,
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      300,
      '2024-01-01T07:00:00',
      '2024-01-02T12:00:00',
      100
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('queries OHLCV metadata and validates output schema', async () => {
    // First update metadata
    await storageService.updateOhlcvMetadata(
      testDbPath,
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      300,
      '2024-01-01T07:00:00',
      '2024-01-02T12:00:00',
      100
    );

    const result = await storageService.queryOhlcvMetadata(
      testDbPath,
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      300,
      '2024-01-01T08:00:00',
      '2024-01-02T10:00:00'
    );

    expect(result.success).toBe(true);
    expect(typeof result.available).toBe('boolean');
    if (result.available) {
      expect(result.time_range_start).toBeDefined();
      expect(result.time_range_end).toBeDefined();
      expect(result.candle_count).toBeDefined();
    }
  });

  it('adds OHLCV exclusion and validates output schema', async () => {
    const result = await storageService.addOhlcvExclusion(
      testDbPath,
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      'No data available'
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('queries OHLCV exclusions and validates output schema', async () => {
    // First add exclusion
    await storageService.addOhlcvExclusion(
      testDbPath,
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      'No data available'
    );

    const result = await storageService.queryOhlcvExclusions(
      testDbPath,
      ['So11111111111111111111111111111111111111112'],
      ['2024-01-01T12:00:00']
    );

    expect(result.success).toBe(true);
    if (result.excluded) {
      expect(Array.isArray(result.excluded)).toBe(true);
      result.excluded.forEach((item) => {
        expect(item.mint).toBeDefined();
        expect(item.alert_timestamp).toBeDefined();
        expect(item.reason).toBeDefined();
      });
    }
  });

  it('generates report and validates output schema', async () => {
    // First store a run
    await storageService.storeRun(
      testDbPath,
      'run_report_test',
      'PT2_SL25',
      'So11111111111111111111111111111111111111112',
      '2024-01-01T12:00:00',
      '2024-01-01T12:00:00',
      '2024-01-02T12:00:00',
      1000.0,
      1200.0,
      20.0
    );

    const result = await storageService.generateReport(
      testDbPath,
      'summary'
    );

    expect(result.success).toBe(true);
    expect(result.report_type).toBe('summary');
    expect(result.data).toBeDefined();
    if (result.data) {
      expect(result.data.total_runs).toBeDefined();
    }
  });
});

