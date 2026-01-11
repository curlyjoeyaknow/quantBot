/**
 * Unit tests for analyzeCoverage workflow
 *
 * Tests the workflow logic in isolation with mocked Python engine.
 * Focus: Spec validation, error handling, context usage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeCoverage } from '../../../src/ohlcv/analyzeCoverage.js';
import type { AnalyzeCoverageContext } from '../../../src/ohlcv/analyzeCoverage.js';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/utils';

describe('analyzeCoverage workflow', () => {
  let mockContext: AnalyzeCoverageContext;
  let mockPythonEngine: any;

  beforeEach(() => {
    mockPythonEngine = {
      runScript: vi.fn(),
    };

    mockContext = {
      pythonEngine: mockPythonEngine,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      clock: {
        now: () => DateTime.fromISO('2025-12-20T12:00:00Z', { zone: 'utc' }),
      },
    };
  });

  describe('Spec Validation', () => {
    it('should reject invalid analysis type', async () => {
      const spec = {
        analysisType: 'invalid' as any,
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid month format', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        startMonth: '2025-13', // Invalid month
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid coverage ratio (too high)', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        minCoverage: 1.5, // > 1
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow(ValidationError);
    });

    it('should reject invalid coverage ratio (negative)', async () => {
      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        minCoverage: -0.1,
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow(ValidationError);
    });

    it('should accept valid overall analysis spec', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
      });

      const spec = {
        analysisType: 'overall' as const,
        chain: 'solana',
        interval: '5m' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };

      const result = await analyzeCoverage(spec, mockContext);
      expect(result.analysisType).toBe('overall');
    });

    it('should accept valid caller analysis spec', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        callers: ['Brook'],
        months: ['2025-12'],
        matrix: {},
      });

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        caller: 'Brook',
        minCoverage: 0.8,
      };

      const result = await analyzeCoverage(spec, mockContext);
      expect(result.analysisType).toBe('caller');
    });
  });

  describe('Overall Coverage Analysis', () => {
    it('should call Python script with correct arguments', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        coverage: {
          byChain: { solana: { totalCandles: 1000, uniqueTokens: 50, intervals: {} } },
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
      });

      const spec = {
        analysisType: 'overall' as const,
        chain: 'solana',
        interval: '5m' as const,
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      };

      await analyzeCoverage(spec, mockContext);

      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.stringMatching(/ohlcv_coverage_map\.py$/),
        {
          format: 'json',
          chain: 'solana',
          interval: '5m',
          'start-date': '2025-01-01',
          'end-date': '2025-12-31',
        },
        expect.any(Object),
        { timeout: 900000 } // Default timeout is 15 minutes (900000ms)
      );
    });

    it('should return structured overall coverage result', async () => {
      const mockCoverage = {
        coverage: {
          byChain: {
            solana: { totalCandles: 1000, uniqueTokens: 50, intervals: { '5m': 1000 } },
          },
          byInterval: {
            '5m': { totalCandles: 1000, uniqueTokens: 50, chains: { solana: 1000 } },
          },
          byPeriod: {
            daily: { '2025-12-01': 100 },
            weekly: { '2025-W48': 500 },
            monthly: { '2025-12': 1000 },
          },
        },
      };

      mockPythonEngine.runScript.mockResolvedValue(mockCoverage);

      const spec = {
        analysisType: 'overall' as const,
        chain: 'solana',
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result).toMatchObject({
        analysisType: 'overall',
        coverage: mockCoverage.coverage,
        metadata: {
          chain: 'solana',
          generatedAt: expect.any(String),
        },
      });
    });

    it('should handle Python script errors gracefully', async () => {
      mockPythonEngine.runScript.mockRejectedValue(new Error('Python script failed'));

      const spec = {
        analysisType: 'overall' as const,
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow(ValidationError);
      expect(mockContext.logger.error).toHaveBeenCalled();
    });
  });

  describe('Caller Coverage Analysis', () => {
    it('should require duckdbPath for caller analysis', async () => {
      const spec = {
        analysisType: 'caller' as const,
        // Missing duckdbPath
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow(ValidationError);
      expect(mockContext.logger.error).toHaveBeenCalled();
    });

    it('should call Python script with correct arguments', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        callers: ['Brook'],
        months: ['2025-12'],
        matrix: {},
      });

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        caller: 'Brook',
        startMonth: '2025-01',
        endMonth: '2025-12',
        minCoverage: 0.9,
        generateFetchPlan: true,
      };

      await analyzeCoverage(spec, mockContext);

      expect(mockPythonEngine.runScript).toHaveBeenCalledWith(
        expect.stringContaining('ohlcv_caller_coverage.py'),
        {
          duckdb: 'data/test.duckdb',
          interval: '5m',
          format: 'json',
          'min-coverage': 0.9,
          verbose: true,
          caller: 'Brook',
          'start-month': '2025-01',
          'end-month': '2025-12',
          'generate-fetch-plan': true,
        },
        expect.any(Object),
        { timeout: 900000 } // Default timeout is 15 minutes (900000ms)
      );
    });

    it('should return structured caller coverage result', async () => {
      const mockCoverage = {
        callers: ['Brook', 'Lsy'],
        months: ['2025-11', '2025-12'],
        matrix: {
          Brook: {
            '2025-11': {
              total_calls: 100,
              calls_with_coverage: 85,
              coverage_ratio: 0.85,
              missing_mints: ['mint1', 'mint2'],
            },
            '2025-12': {
              total_calls: 120,
              calls_with_coverage: 100,
              coverage_ratio: 0.833,
              missing_mints: ['mint3'],
            },
          },
        },
        fetch_plan: [
          {
            caller: 'Brook',
            month: '2025-12',
            missing_mints: ['mint3'],
            total_calls: 120,
            calls_with_coverage: 100,
            current_coverage: 0.833,
            priority: 20,
          },
        ],
      };

      mockPythonEngine.runScript.mockResolvedValue(mockCoverage);

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        generateFetchPlan: true,
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result).toMatchObject({
        analysisType: 'caller',
        callers: mockCoverage.callers,
        months: mockCoverage.months,
        matrix: mockCoverage.matrix,
        fetchPlan: mockCoverage.fetch_plan,
        metadata: {
          duckdbPath: 'data/test.duckdb',
          interval: '5m',
          minCoverage: 0.8,
          generatedAt: expect.any(String),
        },
      });
    });

    it('should handle missing fetch plan gracefully', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        callers: ['Brook'],
        months: ['2025-12'],
        matrix: {},
        // No fetch_plan
      });

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        generateFetchPlan: false,
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result.analysisType).toBe('caller');
      expect(result.fetchPlan).toBeUndefined();
    });
  });

  describe('Context Usage', () => {
    it('should log analysis start', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
      });

      const spec = {
        analysisType: 'overall' as const,
      };

      await analyzeCoverage(spec, mockContext);

      expect(mockContext.logger.info).toHaveBeenCalledWith(
        'Starting OHLCV coverage analysis',
        expect.objectContaining({
          analysisType: 'overall',
        })
      );
    });

    it('should use clock for timestamps', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
      });

      const spec = {
        analysisType: 'overall' as const,
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result.metadata.generatedAt).toBe('2025-12-20T12:00:00.000Z');
    });

    it('should log errors with context', async () => {
      const error = new Error('Python script timeout');
      mockPythonEngine.runScript.mockRejectedValue(error);

      const spec = {
        analysisType: 'overall' as const,
      };

      await expect(analyzeCoverage(spec, mockContext)).rejects.toThrow();

      expect(mockContext.logger.error).toHaveBeenCalledWith(
        'Coverage analysis failed',
        expect.objectContaining({
          error: 'Python script timeout',
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty coverage data', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        coverage: {
          byChain: {},
          byInterval: {},
          byPeriod: { daily: {}, weekly: {}, monthly: {} },
        },
      });

      const spec = {
        analysisType: 'overall' as const,
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result.analysisType).toBe('overall');
      expect(result.coverage.byChain).toEqual({});
    });

    it('should handle empty caller matrix', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        callers: [],
        months: [],
        matrix: {},
      });

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result.analysisType).toBe('caller');
      expect(result.callers).toEqual([]);
      expect(result.months).toEqual([]);
    });

    it('should handle very long caller names', async () => {
      const longName = 'A'.repeat(1000);
      mockPythonEngine.runScript.mockResolvedValue({
        callers: [longName],
        months: ['2025-12'],
        matrix: {},
      });

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        caller: longName,
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result.callers).toContain(longName);
    });

    it('should handle boundary coverage values', async () => {
      mockPythonEngine.runScript.mockResolvedValue({
        callers: ['Test'],
        months: ['2025-12'],
        matrix: {
          Test: {
            '2025-12': {
              total_calls: 100,
              calls_with_coverage: 100,
              coverage_ratio: 1.0, // Perfect coverage
              missing_mints: [],
            },
          },
        },
      });

      const spec = {
        analysisType: 'caller' as const,
        duckdbPath: 'data/test.duckdb',
        minCoverage: 1.0, // Require perfect coverage
      };

      const result = await analyzeCoverage(spec, mockContext);

      expect(result.matrix.Test['2025-12'].coverage_ratio).toBe(1.0);
    });
  });
});
