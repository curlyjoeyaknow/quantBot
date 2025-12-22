/**
 * Isolation tests for surgicalOhlcvFetchHandler
 *
 * Tests that handler can be called with plain objects (REPL-friendly).
 * Focus: Handler can be used programmatically without CLI infrastructure.
 */

import { describe, it, expect, vi } from 'vitest';
import { surgicalOhlcvFetchHandler } from '../../../../src/commands/ingestion/surgical-ohlcv-fetch.js';
import * as workflows from '@quantbot/workflows';

// Mock the workflow
vi.mock('@quantbot/workflows', async () => {
  const actual = await vi.importActual('@quantbot/workflows');
  return {
    ...actual,
    surgicalOhlcvFetch: vi.fn(),
    createOhlcvIngestionContext: vi.fn(() => ({})),
  };
});

describe('surgicalOhlcvFetchHandler isolation tests', () => {
  it('can be called with plain objects (REPL-friendly)', async () => {
    const mockResult = {
      tasksAnalyzed: 5,
      tasksExecuted: 2,
      tasksSucceeded: 2,
      tasksFailed: 0,
      totalCandlesFetched: 1000,
      totalCandlesStored: 1000,
      taskResults: [],
      errors: [],
      startedAtISO: '2025-12-20T12:00:00.000Z',
      completedAtISO: '2025-12-20T12:05:00.000Z',
      durationMs: 300000,
    };

    vi.mocked(workflows.surgicalOhlcvFetch).mockResolvedValue(mockResult);

    // Plain objects - no CLI infrastructure
    const args = {
      duckdb: 'data/test.duckdb',
      interval: '5m' as const,
      auto: true,
      limit: 10,
      minCoverage: 0.8,
      dryRun: false,
      format: 'json' as const, // JSON format returns raw workflow result
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    const result = await surgicalOhlcvFetchHandler(args, fakeCtx);

    // Should return workflow result when format is json
    expect(result).toEqual(mockResult);

    // Should have called workflow
    expect(workflows.surgicalOhlcvFetch).toHaveBeenCalled();
  });

  it('returns deterministic results for same inputs', async () => {
    const mockResult = {
      tasksAnalyzed: 1,
      tasksExecuted: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      totalCandlesFetched: 500,
      totalCandlesStored: 500,
      taskResults: [],
      errors: [],
      startedAtISO: '2025-12-20T12:00:00.000Z',
      completedAtISO: '2025-12-20T12:02:00.000Z',
      durationMs: 120000,
    };

    vi.mocked(workflows.surgicalOhlcvFetch).mockResolvedValue(mockResult);

    const args = {
      duckdb: 'data/test.duckdb',
      interval: '5m' as const,
      caller: 'Brook',
      month: '2025-11',
      minCoverage: 0.8,
      dryRun: true,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    // Call twice with same inputs
    const result1 = await surgicalOhlcvFetchHandler(args, fakeCtx);
    const result2 = await surgicalOhlcvFetchHandler(args, fakeCtx);

    // Should return same result (deterministic)
    expect(result1).toEqual(result2);
  });

  it('handles errors without CLI infrastructure', async () => {
    const error = new Error('Workflow failed');
    vi.mocked(workflows.surgicalOhlcvFetch).mockRejectedValue(error);

    const args = {
      duckdb: 'data/test.duckdb',
      interval: '5m' as const,
      auto: true,
      limit: 10,
      minCoverage: 0.8,
      dryRun: false,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    // Should propagate error (no process.exit)
    await expect(surgicalOhlcvFetchHandler(args, fakeCtx)).rejects.toThrow('Workflow failed');
  });

  it('uses DUCKDB_PATH environment variable when duckdb arg not provided', async () => {
    const originalEnv = process.env.DUCKDB_PATH;
    process.env.DUCKDB_PATH = '/custom/path/to/db.duckdb';

    const mockResult = {
      tasksAnalyzed: 0,
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      taskResults: [],
      errors: [],
      startedAtISO: '2025-12-20T12:00:00.000Z',
      completedAtISO: '2025-12-20T12:00:01.000Z',
      durationMs: 1000,
    };

    vi.mocked(workflows.surgicalOhlcvFetch).mockResolvedValue(mockResult);

    const args = {
      // No duckdb provided
      interval: '5m' as const,
      auto: true,
      limit: 10,
      minCoverage: 0.8,
      dryRun: true,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    await surgicalOhlcvFetchHandler(args, fakeCtx);

    // Should use env var
    const callArgs = vi.mocked(workflows.surgicalOhlcvFetch).mock.calls[0][0];
    expect(callArgs.duckdbPath).toContain('db.duckdb');

    // Restore env
    if (originalEnv) {
      process.env.DUCKDB_PATH = originalEnv;
    } else {
      delete process.env.DUCKDB_PATH;
    }
  });

  it('throws ConfigurationError when duckdb path not provided and no env var', async () => {
    const originalEnv = process.env.DUCKDB_PATH;
    delete process.env.DUCKDB_PATH;

    const args = {
      // No duckdb provided
      interval: '5m' as const,
      auto: true,
      limit: 10,
      minCoverage: 0.8,
      dryRun: true,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    await expect(surgicalOhlcvFetchHandler(args, fakeCtx)).rejects.toThrow(
      'DuckDB path is required'
    );

    // Restore env
    if (originalEnv) {
      process.env.DUCKDB_PATH = originalEnv;
    }
  });
});
