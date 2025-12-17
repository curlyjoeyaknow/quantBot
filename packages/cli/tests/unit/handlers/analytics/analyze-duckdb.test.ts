/**
 * Tests for DuckDB analytics handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeDuckdbHandler } from '../../../../src/handlers/analytics/analyze-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { execa } from 'execa';
import { ValidationError, AppError } from '@quantbot/utils';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('analyzeDuckdbHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockCtx = {
      services: {} as any,
    } as CommandContext;

    vi.clearAllMocks();
  });

  it('should call Python script for caller analysis', async () => {
    const mockStdout = JSON.stringify({
      caller_name: 'Brook',
      total_calls: 100,
      win_rate: 0.65,
      avg_return: 2.5,
    });

    vi.mocked(execa).mockResolvedValue({
      stdout: mockStdout,
      stderr: '',
    } as any);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      caller: 'Brook',
    };

    const result = await analyzeDuckdbHandler(args, mockCtx);

    expect(execa).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        expect.stringContaining('analyze.py'),
        '--duckdb',
        '/path/to/tele.duckdb',
        '--caller',
        'Brook',
      ]),
      expect.objectContaining({
        encoding: 'utf8',
        timeout: 60000,
      })
    );

    expect(result).toHaveProperty('caller_name', 'Brook');
    expect(result).toHaveProperty('total_calls');
  });

  it('should call Python script for mint analysis', async () => {
    const mockStdout = JSON.stringify({
      mint: 'So11111111111111111111111111111111111111112',
      total_candles: 1000,
      volatility: 0.05,
    });

    vi.mocked(execa).mockResolvedValue({
      stdout: mockStdout,
      stderr: '',
    } as any);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      mint: 'So11111111111111111111111111111111111111112',
    };

    const result = await analyzeDuckdbHandler(args, mockCtx);

    expect(execa).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([
        expect.stringContaining('analyze.py'),
        '--duckdb',
        '/path/to/tele.duckdb',
        '--mint',
        'So11111111111111111111111111111111111111112',
      ]),
      expect.anything()
    );

    expect(result).toHaveProperty('mint');
  });

  it('should throw ValidationError if no analysis type specified', async () => {
    const args = {
      duckdb: '/path/to/tele.duckdb',
    };

    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow('Must specify');
  });

  it('should handle Python script errors', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('Python script failed'));

    const args = {
      duckdb: '/path/to/tele.duckdb',
      caller: 'Brook',
    };

    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow(AppError);
    await expect(analyzeDuckdbHandler(args, mockCtx)).rejects.toThrow('Analysis failed');
  });
});
