/**
 * Unit tests for analyzeCoverageHandler
 *
 * Tests the handler layer - argument parsing, context usage, workflow invocation.
 * Focus: Handler responsibilities, not workflow logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeCoverageHandler } from '../../../../src/commands/ohlcv/analyze-coverage.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
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

describe('analyzeCoverageHandler', () => {
  let mockContext: CommandContext;
  let mockPythonEngine: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPythonEngine = {
      runScript: vi.fn(),
    };

    mockContext = {
      services: {
        pythonEngine: vi.fn(() => mockPythonEngine),
      },
    } as any;
  });

  describe('Overall Analysis', () => {
    it('should call workflow with correct spec for overall analysis', async () => {
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

      const args = {
        analysisType: 'overall' as const,
        chain: 'solana',
        interval: '5m' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      const result = await analyzeCoverageHandler(args, mockContext);

      // Should call analyzeCoverage with the correct spec
      expect(workflows.analyzeCoverage).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisType: 'overall',
          chain: 'solana',
          interval: '5m',
          startDate: '2025-01-01',
          endDate: '2025-12-31',
          minCoverage: 0.8,
          generateFetchPlan: false,
        }),
        expect.objectContaining({
          pythonEngine: mockPythonEngine,
          logger: expect.any(Object),
          clock: expect.any(Object),
        })
      );

      // Should return workflow result
      expect(result).toEqual(mockResult);
    });

    it('should not include duckdbPath for overall analysis', async () => {
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

      const args = {
        analysisType: 'overall' as const,
        duckdb: 'data/test.duckdb', // Should be ignored for overall
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      await analyzeCoverageHandler(args, mockContext);

      const callArgs = vi.mocked(workflows.analyzeCoverage).mock.calls[0][0];
      expect(callArgs.duckdbPath).toBeUndefined();
    });
  });

  describe('Caller Analysis', () => {
    it('should call workflow with correct spec for caller analysis', async () => {
      const mockResult = {
        analysisType: 'caller' as const,
        callers: ['Brook'],
        months: ['2025-12'],
        matrix: {},
        metadata: {
          duckdbPath: expect.stringContaining('test.duckdb'),
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
        startMonth: '2025-01',
        endMonth: '2025-12',
        minCoverage: 0.9,
        generateFetchPlan: true,
        format: 'json' as const,
      };

      const result = await analyzeCoverageHandler(args, mockContext);

      // Should call workflow with correct spec
      expect(workflows.analyzeCoverage).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisType: 'caller',
          duckdbPath: expect.stringContaining('test.duckdb'),
          caller: 'Brook',
          startMonth: '2025-01',
          endMonth: '2025-12',
          minCoverage: 0.9,
          generateFetchPlan: true,
        }),
        expect.any(Object)
      );

      // Should return workflow result
      expect(result).toEqual(mockResult);
    });

    it('should use default duckdb path if not provided', async () => {
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
        // No duckdb path provided
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      await analyzeCoverageHandler(args, mockContext);

      const callArgs = vi.mocked(workflows.analyzeCoverage).mock.calls[0][0];
      expect(callArgs.duckdbPath).toBeDefined();
      expect(callArgs.duckdbPath).toContain('tele.duckdb'); // Default path
    });

    it('should resolve relative duckdb paths', async () => {
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
        format: 'json' as const,
      };

      await analyzeCoverageHandler(args, mockContext);

      const callArgs = vi.mocked(workflows.analyzeCoverage).mock.calls[0][0];
      // Should be absolute path
      expect(callArgs.duckdbPath).toMatch(/^\/.*test\.duckdb$/);
    });
  });

  describe('Context Creation', () => {
    it('should create workflow context with pythonEngine from CommandContext', async () => {
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

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      await analyzeCoverageHandler(args, mockContext);

      // Should get pythonEngine from context
      expect(mockContext.services.pythonEngine).toHaveBeenCalled();

      // Should pass pythonEngine to workflow
      const workflowContext = vi.mocked(workflows.analyzeCoverage).mock.calls[0][1];
      expect(workflowContext.pythonEngine).toBe(mockPythonEngine);
    });

    it('should create workflow context with logger', async () => {
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

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      await analyzeCoverageHandler(args, mockContext);

      const workflowContext = vi.mocked(workflows.analyzeCoverage).mock.calls[0][1];
      expect(workflowContext.logger).toBeDefined();
      expect(workflowContext.logger.info).toBeInstanceOf(Function);
      expect(workflowContext.logger.error).toBeInstanceOf(Function);
      expect(workflowContext.logger.debug).toBeInstanceOf(Function);
    });

    it('should create workflow context with clock', async () => {
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

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      await analyzeCoverageHandler(args, mockContext);

      const workflowContext = vi.mocked(workflows.analyzeCoverage).mock.calls[0][1];
      expect(workflowContext.clock).toBeDefined();
      expect(workflowContext.clock.now).toBeInstanceOf(Function);
    });
  });

  describe('Error Handling', () => {
    it('should propagate workflow errors', async () => {
      const error = new Error('Workflow failed');
      vi.mocked(workflows.analyzeCoverage).mockRejectedValue(error);

      const args = {
        analysisType: 'overall' as const,
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      await expect(analyzeCoverageHandler(args, mockContext)).rejects.toThrow('Workflow failed');
    });
  });

  describe('Return Value', () => {
    it('should return workflow result unchanged', async () => {
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
          chain: 'solana',
          generatedAt: '2025-12-20T12:00:00.000Z',
        },
      };

      vi.mocked(workflows.analyzeCoverage).mockResolvedValue(mockResult);

      const args = {
        analysisType: 'overall' as const,
        chain: 'solana',
        minCoverage: 0.8,
        generateFetchPlan: false,
        format: 'json' as const,
      };

      const result = await analyzeCoverageHandler(args, mockContext);

      // Should return exact workflow result
      expect(result).toBe(mockResult);
    });
  });
});
