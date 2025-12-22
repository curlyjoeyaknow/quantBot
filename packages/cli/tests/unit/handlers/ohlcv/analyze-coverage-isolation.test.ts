/**
 * Isolation tests for analyzeCoverageHandler
 *
 * Tests that handler can be called with plain objects (REPL-friendly).
 * Focus: Handler can be used programmatically without CLI infrastructure.
 */

import { describe, it, expect, vi } from 'vitest';
import { analyzeCoverageHandler } from '../../../../src/handlers/ohlcv/analyze-coverage.js';
import * as workflows from '@quantbot/workflows';

// Mock the workflow
vi.mock('@quantbot/workflows', async () => {
  const actual = await vi.importActual('@quantbot/workflows');
  return {
    ...actual,
    analyzeCoverage: vi.fn(),
    createOhlcvIngestionContext: vi.fn(() => ({})),
  };
});

describe('analyzeCoverageHandler isolation tests', () => {
  it('can be called with plain objects (REPL-friendly)', async () => {
    const mockResult = {
      analysisType: 'overall' as const,
      coverage: {
        byChain: {
          solana: { totalCandles: 1000, uniqueTokens: 50, intervals: {} },
        },
        byInterval: {},
        byPeriod: { daily: {}, weekly: {}, monthly: {} },
      },
      metadata: {
        generatedAt: '2025-12-20T12:00:00.000Z',
      },
    };

    vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

    // Plain objects - no CLI infrastructure
    const args = {
      analysisType: 'overall' as const,
      chain: 'solana',
      interval: '5m' as const,
      minCoverage: 0.8,
      generateFetchPlan: false,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    const result = await analyzeCoverageHandler(args, fakeCtx);

    // Should return workflow result
    expect(result).toEqual(mockResult);

    // Should have called workflow
    expect(workflows.analyzeCoverage).toHaveBeenCalled();
  });

  it('returns deterministic results for same inputs', async () => {
    const mockResult = {
      analysisType: 'caller' as const,
      callers: ['Brook'],
      months: ['2025-12'],
      matrix: {},
      metadata: {
        duckdbPath: 'data/test.duckdb',
        interval: '5m',
        minCoverage: 0.8,
        generatedAt: '2025-12-20T12:00:00.000Z',
      },
    };

    vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

    const args = {
      analysisType: 'caller' as const,
      duckdb: 'data/test.duckdb',
      caller: 'Brook',
      minCoverage: 0.8,
      generateFetchPlan: false,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    // Call twice with same inputs
    const result1 = await analyzeCoverageHandler(args, fakeCtx);
    const result2 = await analyzeCoverageHandler(args, fakeCtx);

    // Should return same result (deterministic)
    expect(result1).toEqual(result2);
  });

  it('handles errors without CLI infrastructure', async () => {
    const error = new Error('Workflow failed');
    vi.mocked(workflows.analyzeCoverage).mockRejectedValue(error);

    const args = {
      analysisType: 'overall' as const,
      minCoverage: 0.8,
      generateFetchPlan: false,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    // Should propagate error (no process.exit)
    await expect(analyzeCoverageHandler(args, fakeCtx)).rejects.toThrow('Workflow failed');
  });

  it('resolves relative duckdb paths for caller analysis', async () => {
    const mockResult = {
      analysisType: 'caller' as const,
      callers: [],
      months: [],
      matrix: {},
      metadata: {
        duckdbPath: expect.any(String),
        interval: '5m',
        minCoverage: 0.8,
        generatedAt: '2025-12-20T12:00:00.000Z',
      },
    };

    vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

    const args = {
      analysisType: 'caller' as const,
      duckdb: 'data/test.duckdb', // Relative path
      minCoverage: 0.8,
      generateFetchPlan: false,
    };

    const fakeCtx = {
      services: {
        pythonEngine: () => ({ runScript: vi.fn() }),
      },
    } as any;

    await analyzeCoverageHandler(args, fakeCtx);

    const callArgs = vi.mocked(workflows.analyzeCoverage).mock.calls[0][0];
    // Should be absolute path
    expect(callArgs.duckdbPath).toMatch(/^\/.*test\.duckdb$/);
  });
});
