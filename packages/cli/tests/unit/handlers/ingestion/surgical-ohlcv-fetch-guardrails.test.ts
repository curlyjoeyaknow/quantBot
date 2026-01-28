/**
 * Guardrail tests for surgicalOhlcvFetchHandler
 *
 * These tests enforce CLI handler architectural rules.
 * They ensure handlers follow the thin adapter pattern.
 *
 * Focus: Handler pattern compliance, behavioral verification.
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
    createOhlcvIngestionContext: vi.fn(async () => ({
      ports: {
        marketData: {
          fetchOhlcv: vi.fn(),
        },
      },
    })),
  };
});

describe('surgicalOhlcvFetchHandler guardrail tests', () => {
  describe('Handler Pattern: Thin Adapter', () => {
    it('MUST call workflow (not implement logic)', async () => {
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
        completedAtISO: '2025-12-20T12:00:00.000Z',
        durationMs: 0,
      };

      vi.mocked(workflows.surgicalOhlcvFetch).mockResolvedValue(mockResult);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        duckdb: 'data/test.duckdb',
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
      };

      await surgicalOhlcvFetchHandler(args, mockContext);

      // Should delegate to workflow
      expect(workflows.surgicalOhlcvFetch).toHaveBeenCalled();
    });

    it('MUST propagate errors (no try/catch)', async () => {
      const error = new Error('Workflow failed');
      vi.mocked(workflows.surgicalOhlcvFetch).mockRejectedValue(error);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        duckdb: 'data/test.duckdb',
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
      };

      // Should propagate error unchanged
      await expect(surgicalOhlcvFetchHandler(args, mockContext)).rejects.toThrow('Workflow failed');
    });

    it('MUST NOT call process.exit on error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      const error = new Error('Workflow failed');
      vi.mocked(workflows.surgicalOhlcvFetch).mockRejectedValue(error);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        duckdb: 'data/test.duckdb',
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
      };

      try {
        await surgicalOhlcvFetchHandler(args, mockContext);
      } catch {
        // Expected to throw
      }

      // Should not call process.exit
      expect(exitSpy).not.toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });

  describe('Handler Pattern: Context Usage', () => {
    it('MUST get services from CommandContext', async () => {
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
        completedAtISO: '2025-12-20T12:00:00.000Z',
        durationMs: 0,
      };

      vi.mocked(workflows.surgicalOhlcvFetch).mockResolvedValue(mockResult);

      const mockPythonEngine = { runScript: vi.fn() };
      const mockContext = {
        services: {
          pythonEngine: vi.fn(() => mockPythonEngine),
        },
      } as any;

      const args = {
        duckdb: 'data/test.duckdb',
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
      };

      await surgicalOhlcvFetchHandler(args, mockContext);

      // Should get pythonEngine from context
      expect(mockContext.services.pythonEngine).toHaveBeenCalled();
    });
  });

  describe('Handler Pattern: Return Value', () => {
    it('MUST return workflow result unchanged', async () => {
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

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        duckdb: 'data/test.duckdb',
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
        format: 'json' as const, // JSON format returns raw workflow result
      };

      const result = await surgicalOhlcvFetchHandler(args, mockContext);

      // Should return exact workflow result when format is json
      expect(result).toBe(mockResult);
    });
  });

  describe('Configuration: Path Resolution', () => {
    it('MUST resolve relative paths to absolute', async () => {
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
        completedAtISO: '2025-12-20T12:00:00.000Z',
        durationMs: 0,
      };

      vi.mocked(workflows.surgicalOhlcvFetch).mockResolvedValue(mockResult);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        duckdb: 'data/test.duckdb', // Relative path
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
      };

      await surgicalOhlcvFetchHandler(args, mockContext);

      const callArgs = vi.mocked(workflows.surgicalOhlcvFetch).mock.calls[0][0];

      // Should be absolute path
      expect(callArgs.duckdbPath).toMatch(/^\//);
      expect(callArgs.duckdbPath).toContain('test.duckdb');
    });

    it('MUST throw ConfigurationError when path missing', async () => {
      const originalEnv = process.env.DUCKDB_PATH;
      delete process.env.DUCKDB_PATH;

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        // No duckdb provided
        interval: '5m' as const,
        auto: true,
        limit: 10,
        minCoverage: 0.8,
        dryRun: false,
      };

      // Should throw ConfigurationError
      await expect(surgicalOhlcvFetchHandler(args, mockContext)).rejects.toThrow(
        'DuckDB path is required'
      );

      // Restore env
      if (originalEnv) {
        process.env.DUCKDB_PATH = originalEnv;
      }
    });
  });
});
