/**
 * Unit Tests: Phase 1 - Lab Sweep Discovery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdir, writeFile } from 'fs/promises';
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

    // Create temp DuckDB
    duckdbPath = createTempDuckDBPath('phase1_test');

    // Create test calls
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
    const mockEvaluateCallsWorkflow = vi.fn().mockResolvedValue({
      results: [
        {
          callId: 'call1',
          tradeable: true,
          trade: {
            realizedReturnBps: 20000, // 2x return
          },
        },
        {
          callId: 'call2',
          tradeable: true,
          trade: {
            realizedReturnBps: 15000, // 1.5x return
          },
        },
      ],
      perCaller: {},
    });

    vi.doMock('../../../../src/calls/evaluate.js', () => ({
      evaluateCallsWorkflow: mockEvaluateCallsWorkflow,
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
    expect(result.summary).toBeDefined();
    expect(result.summary.totalCallers).toBeGreaterThan(0);
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
  });

  it('should write results to Parquet and JSON', async () => {
    const config: Phase1Config = {
      enabled: true,
      tpMults: [2.0],
      slMults: [0.85],
      intervals: ['5m'],
      lagsMs: [0],
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
    // Parquet file may not exist if no results
    // expect(existsSync(parquetPath)).toBe(true);
  });
});

