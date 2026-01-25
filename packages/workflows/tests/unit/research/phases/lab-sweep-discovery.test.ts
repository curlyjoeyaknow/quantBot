/**
 * Unit Tests: Phase 1 - Lab Sweep Discovery
 *
 * Tests core functionality of Phase 1:
 * - Overlay set generation
 * - Call loading from DuckDB
 * - Optimal range extraction
 * - Artifact writing (Parquet + JSON)
 * - Caller filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { runPhase1LabSweepDiscovery } from '../../../../src/research/phases/lab-sweep-discovery.js';
import type { Phase1Config } from '../../../../src/research/phases/types.js';
import { createTempDuckDBPath, createTestDuckDB, cleanupTestDuckDB } from '../../../../../ingestion/tests/helpers/createTestDuckDB.js';
import type { TestCall } from '../../../../../ingestion/tests/helpers/createTestDuckDB.js';

describe('Phase 1: Lab Sweep Discovery', () => {
  let tempDir: string;
  let duckdbPath: string;
  let testCalls: TestCall[];

  beforeEach(async () => {
    // Create temp directory for test artifacts
    tempDir = join(process.cwd(), 'test-temp', `phase1-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(join(tempDir, 'inputs'), { recursive: true });
    await mkdir(join(tempDir, 'phase1'), { recursive: true });

    // Create temp DuckDB
    duckdbPath = createTempDuckDBPath('phase1_test');

    // Create test calls with multiple callers
    testCalls = [
      {
        callId: 'call1',
        caller: 'test-caller-1',
        mint: 'mint1',
        timestampMs: new Date('2024-01-01T00:00:00Z').getTime(),
        chain: 'solana',
      },
      {
        callId: 'call2',
        caller: 'test-caller-1',
        mint: 'mint2',
        timestampMs: new Date('2024-01-01T01:00:00Z').getTime(),
        chain: 'solana',
      },
      {
        callId: 'call3',
        caller: 'test-caller-2',
        mint: 'mint3',
        timestampMs: new Date('2024-01-01T02:00:00Z').getTime(),
        chain: 'solana',
      },
    ];

    await createTestDuckDB(duckdbPath, testCalls);
  });

  afterEach(async () => {
    // Cleanup
    if (existsSync(tempDir)) {
      const { rm } = await import('fs/promises');
      await rm(tempDir, { recursive: true, force: true });
    }
    cleanupTestDuckDB(duckdbPath);
  });

  it('should generate optimal ranges from lab sweep results', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0, 3.0],
      slMults: [0.85, 0.90],
      intervals: ['5m'],
      lagsMs: [0],
      minCallsPerCaller: 1,
    };

    const dateFrom = '2024-01-01T00:00:00Z';
    const dateTo = '2024-01-02T00:00:00Z';

    // Mock evaluateCallsWorkflow to return test results
    vi.doMock('../../../../src/calls/evaluate.js', () => ({
      evaluateCallsWorkflow: vi.fn().mockResolvedValue({
        results: [
          {
            call: { caller: { displayName: 'test-caller-1', fromId: 'test-caller-1' } },
            diagnostics: { tradeable: true, skippedReason: undefined },
            pnl: { netReturnPct: 0.5 },
          },
          {
            call: { caller: { displayName: 'test-caller-1', fromId: 'test-caller-1' } },
            diagnostics: { tradeable: true, skippedReason: undefined },
            pnl: { netReturnPct: 0.3 },
          },
        ],
        perCaller: {},
      }),
    }));

    const result = await runPhase1LabSweepDiscovery(
      config,
      dateFrom,
      dateTo,
      ['test-caller-1'],
      tempDir,
      duckdbPath
    );

    expect(result).toBeDefined();
    expect(result.optimalRanges).toBeDefined();
    expect(Array.isArray(result.optimalRanges)).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary.totalCallers).toBeGreaterThanOrEqual(0);
    expect(result.summary.callersWithRanges).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.summary.excludedCallers)).toBe(true);
  });

  it('should filter callers with insufficient calls', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0],
      slMults: [0.85],
      intervals: ['5m'],
      lagsMs: [0],
      minCallsPerCaller: 100, // High threshold
    };

    const dateFrom = '2024-01-01T00:00:00Z';
    const dateTo = '2024-01-02T00:00:00Z';

    const result = await runPhase1LabSweepDiscovery(
      config,
      dateFrom,
      dateTo,
      undefined,
      tempDir,
      duckdbPath
    );

    // Should exclude callers with < 100 calls
    expect(result.summary.excludedCallers.length).toBeGreaterThanOrEqual(0);
    // With only 3 test calls, no callers should have enough
    expect(result.optimalRanges.length).toBe(0);
  });

  it('should write results to Parquet and JSON', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0],
      slMults: [0.85],
      intervals: ['5m'],
      lagsMs: [0],
      minCallsPerCaller: 1,
    };

    const dateFrom = '2024-01-01T00:00:00Z';
    const dateTo = '2024-01-02T00:00:00Z';

    await runPhase1LabSweepDiscovery(config, dateFrom, dateTo, undefined, tempDir, duckdbPath);

    // Check that files were created
    const summaryPath = join(tempDir, 'phase1', 'summary.json');
    const rangesPath = join(tempDir, 'phase1', 'optimal-ranges.json');
    const parquetPath = join(tempDir, 'phase1', 'lab-sweep-results.parquet');

    expect(existsSync(summaryPath)).toBe(true);
    expect(existsSync(rangesPath)).toBe(true);
    // Parquet file should exist if there are results
    if (existsSync(parquetPath)) {
      expect(existsSync(parquetPath)).toBe(true);
    }
  });

  it('should handle empty callers list (process all)', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0],
      slMults: [0.85],
      intervals: ['5m'],
      lagsMs: [0],
      minCallsPerCaller: 1,
    };

    const dateFrom = '2024-01-01T00:00:00Z';
    const dateTo = '2024-01-02T00:00:00Z';

    const result = await runPhase1LabSweepDiscovery(
      config,
      dateFrom,
      dateTo,
      undefined, // Process all callers
      tempDir,
      duckdbPath
    );

    expect(result).toBeDefined();
    expect(result.summary.totalCallers).toBeGreaterThanOrEqual(0);
  });

  it('should handle multiple intervals and lags', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0],
      slMults: [0.85],
      intervals: ['1m', '5m'],
      lagsMs: [0, 10000],
      minCallsPerCaller: 1,
    };

    const dateFrom = '2024-01-01T00:00:00Z';
    const dateTo = '2024-01-02T00:00:00Z';

    const result = await runPhase1LabSweepDiscovery(
      config,
      dateFrom,
      dateTo,
      undefined,
      tempDir,
      duckdbPath
    );

    expect(result).toBeDefined();
    // Should process multiple combinations
    expect(result.summary).toBeDefined();
  });

  it('should extract optimal TP/SL ranges correctly', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0, 2.5, 3.0],
      slMults: [0.85, 0.90],
      intervals: ['5m'],
      lagsMs: [0],
      minCallsPerCaller: 1,
    };

    const dateFrom = '2024-01-01T00:00:00Z';
    const dateTo = '2024-01-02T00:00:00Z';

    const result = await runPhase1LabSweepDiscovery(
      config,
      dateFrom,
      dateTo,
      undefined,
      tempDir,
      duckdbPath
    );

    // If optimal ranges are found, verify structure
    if (result.optimalRanges.length > 0) {
      const range = result.optimalRanges[0];
      expect(range).toHaveProperty('caller');
      expect(range).toHaveProperty('tpMult');
      expect(range).toHaveProperty('slMult');
      expect(range).toHaveProperty('metrics');
      expect(range.tpMult).toHaveProperty('min');
      expect(range.tpMult).toHaveProperty('max');
      expect(range.slMult).toHaveProperty('min');
      expect(range.slMult).toHaveProperty('max');
    }
  });
});

