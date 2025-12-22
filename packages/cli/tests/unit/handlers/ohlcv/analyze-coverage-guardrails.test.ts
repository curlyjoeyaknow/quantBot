/**
 * Guardrail tests for analyzeCoverageHandler
 *
 * These tests enforce CLI handler architectural rules.
 * They ensure handlers follow the thin adapter pattern.
 *
 * Focus: Handler pattern compliance, behavioral verification.
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
  };
});

describe('analyzeCoverageHandler guardrail tests', () => {
  describe('Handler Pattern: Thin Adapter', () => {
    it('MUST call workflow (not implement logic)', async () => {
      const mockResult = {
        analysisType: 'overall' as const,
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
        metadata: {
          generatedAt: '2025-12-20T12:00:00.000Z',
        },
      };

      vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
      };

      await analyzeCoverageHandler(args, mockContext);

      // Should delegate to workflow
      expect(workflows.analyzeCoverage).toHaveBeenCalled();
    });

    it('MUST propagate errors (no try/catch)', async () => {
      const error = new Error('Workflow failed');
      vi.mocked(workflows.analyzeCoverage).mockRejectedValue(error);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
      };

      // Should propagate error unchanged
      await expect(analyzeCoverageHandler(args, mockContext)).rejects.toThrow('Workflow failed');
    });

    it('MUST NOT call process.exit on error', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });

      const error = new Error('Workflow failed');
      vi.mocked(workflows.analyzeCoverage).mockRejectedValue(error);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
      };

      try {
        await analyzeCoverageHandler(args, mockContext);
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
        analysisType: 'overall' as const,
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
        metadata: {
          generatedAt: '2025-12-20T12:00:00.000Z',
        },
      };

      vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

      const mockPythonEngine = { runScript: vi.fn() };
      const mockContext = {
        services: {
          pythonEngine: vi.fn(() => mockPythonEngine),
        },
      } as any;

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
      };

      await analyzeCoverageHandler(args, mockContext);

      // Should get pythonEngine from context
      expect(mockContext.services.pythonEngine).toHaveBeenCalled();
    });
  });

  describe('Handler Pattern: Return Value', () => {
    it('MUST return workflow result unchanged', async () => {
      const mockResult = {
        analysisType: 'overall' as const,
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
        metadata: {
          generatedAt: '2025-12-20T12:00:00.000Z',
        },
      };

      vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
      };

      const result = await analyzeCoverageHandler(args, mockContext);

      // Should return exact workflow result (no transformation)
      expect(result).toBe(mockResult);
    });
  });

  describe('Configuration: Path Resolution', () => {
    it('MUST resolve relative paths to absolute', async () => {
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

      const mockContext = {
        services: {
          pythonEngine: () => ({ runScript: vi.fn() }),
        },
      } as any;

      const args = {
        analysisType: 'caller' as const,
        duckdb: 'data/test.duckdb', // Relative path
        minCoverage: 0.8,
        generateFetchPlan: false,
      };

      await analyzeCoverageHandler(args, mockContext);

      const callArgs = vi.mocked(workflows.analyzeCoverage).mock.calls[0][0];

      // Should be absolute path
      expect(callArgs.duckdbPath).toMatch(/^\//);
      expect(callArgs.duckdbPath).toContain('test.duckdb');
    });
  });
});
