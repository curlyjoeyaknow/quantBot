/**
 * Tests for DuckDB analytics handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeDuckdbHandler } from '../../../../src/commands/analytics/analyze-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { ValidationError, AppError } from '@quantbot/infra/utils';
import type { AnalyticsService } from '@quantbot/analytics';

describe('analyzeDuckdbHandler', () => {
  let mockCtx: CommandContext;
  let mockService: AnalyticsService;

  beforeEach(() => {
    mockService = {
      runAnalysis: vi.fn(),
    } as unknown as AnalyticsService;

    mockCtx = {
      services: {
        analytics: () => mockService,
      },
    } as unknown as CommandContext;

    vi.clearAllMocks();
  });

  it('should call service for caller analysis', async () => {
    const mockResult = {
      caller_name: 'Brook',
      total_calls: 100,
      win_rate: 0.65,
      avg_return: 2.5,
    };

    vi.mocked(mockService.runAnalysis).mockResolvedValue(mockResult);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      caller: 'Brook',
    };

    const result = await analyzeDuckdbHandler(args, mockCtx);

    expect(mockService.runAnalysis).toHaveBeenCalledWith({
      duckdb: '/path/to/tele.duckdb',
      caller: 'Brook',
    });

    expect(result).toHaveProperty('caller_name', 'Brook');
    expect(result).toHaveProperty('total_calls');
  });

  it('should call service for mint analysis', async () => {
    const mockResult = {
      mint: 'So11111111111111111111111111111111111111112',
      total_candles: 1000,
      volatility: 0.05,
    };

    vi.mocked(mockService.runAnalysis).mockResolvedValue(mockResult);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      mint: 'So11111111111111111111111111111111111111112',
    };

    const result = await analyzeDuckdbHandler(args, mockCtx);

    expect(mockService.runAnalysis).toHaveBeenCalledWith({
      duckdb: '/path/to/tele.duckdb',
      mint: 'So11111111111111111111111111111111111111112',
    });

    expect(result).toHaveProperty('mint');
  });

  it('should throw ValidationError if no analysis type specified', async () => {
    const args = {
      duckdb: '/path/to/tele.duckdb',
    };

    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow('Must specify');
  });

  it('should propagate service errors', async () => {
    const error = new AppError('Analysis failed', 'ANALYSIS_FAILED', 500);
    vi.mocked(mockService.runAnalysis).mockRejectedValue(error);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      caller: 'Brook',
    };

    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow(AppError);
    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow('Analysis failed');
  });
});
