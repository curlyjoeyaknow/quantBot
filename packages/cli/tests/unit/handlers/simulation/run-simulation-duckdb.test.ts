/**
 * Tests for DuckDB simulation handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSimulationDuckdbHandler } from '../../../../src/handlers/simulation/run-simulation-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { execa } from 'execa';
import { ValidationError, AppError } from '@quantbot/utils';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('runSimulationDuckdbHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockCtx = {
      services: {} as any,
    } as CommandContext;

    vi.clearAllMocks();
  });

  it('should call Python script with correct config', async () => {
    const mockStdout = JSON.stringify({
      results: [
        {
          run_id: 'test-run-id',
          final_capital: 1200.0,
          total_return_pct: 20.0,
          total_trades: 1,
        },
      ],
      summary: {
        total_runs: 1,
        successful: 1,
        failed: 0,
      },
    });

    vi.mocked(execa).mockResolvedValue({
      stdout: mockStdout,
      stderr: '',
    } as any);

    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: {
        strategy_id: 'test_strategy',
        name: 'Test Strategy',
        entry_type: 'immediate' as const,
        profit_targets: [{ target: 2.0, percent: 0.5 }],
        stop_loss_pct: 0.2,
      },
      mint: 'So11111111111111111111111111111111111111112',
      alert_timestamp: '2024-01-01T12:00:00Z',
      batch: false,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
    };

    const result = await runSimulationDuckdbHandler(args, mockCtx);

    expect(execa).toHaveBeenCalledWith(
      'python3',
      [expect.stringContaining('run_simulation.py')],
      expect.objectContaining({
        input: expect.stringContaining('"duckdb_path"'),
        encoding: 'utf8',
        timeout: 300000,
      })
    );

    expect(result).toHaveProperty('results');
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toHaveProperty('run_id');
  });

  it('should throw ValidationError if mint is missing in single mode', async () => {
    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: {
        strategy_id: 'test_strategy',
        name: 'Test Strategy',
        entry_type: 'immediate' as const,
        profit_targets: [],
      },
      batch: false,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
    };

    await expect(runSimulationDuckdbHandler(args as any, mockCtx)).rejects.toThrow(ValidationError);
    await expect(runSimulationDuckdbHandler(args as any, mockCtx)).rejects.toThrow(
      'mint is required'
    );
  });

  it('should handle Python script errors', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('Python script failed'));

    const args = {
      duckdb: '/path/to/tele.duckdb',
      strategy: {
        strategy_id: 'test_strategy',
        name: 'Test Strategy',
        entry_type: 'immediate' as const,
        profit_targets: [],
      },
      mint: 'So11111111111111111111111111111111111111112',
      batch: false,
      initial_capital: 1000.0,
      lookback_minutes: 260,
      lookforward_minutes: 1440,
    };

    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow(AppError);
    await expect(runSimulationDuckdbHandler(args, mockCtx)).rejects.toThrow('Simulation failed');
  });
});
