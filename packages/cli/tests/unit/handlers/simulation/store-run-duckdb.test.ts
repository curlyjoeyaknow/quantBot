/**
 * Unit tests for store-run-duckdb handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeRunDuckdbHandler } from '../../../../src/handlers/simulation/store-run-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import type { PythonEngine } from '@quantbot/utils';

describe('storeRunDuckdbHandler', () => {
  let mockEngine: PythonEngine;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockEngine = {
      runDuckDBStorage: vi.fn(),
    } as unknown as PythonEngine;

    mockCtx = {
      services: {
        pythonEngine: () => mockEngine,
      },
    } as unknown as CommandContext;
  });

  it('should call PythonEngine with correct parameters', async () => {
    vi.mocked(mockEngine.runDuckDBStorage).mockResolvedValue({
      success: true,
      run_id: 'run123',
    });

    const args = {
      duckdb: '/path/to/sim.duckdb',
      runId: 'run123',
      strategyId: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alertTimestamp: '2024-01-01T00:00:00Z',
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-02T00:00:00Z',
      initialCapital: 1000.0,
      finalCapital: 1200.0,
      totalReturnPct: 20.0,
      maxDrawdownPct: 5.0,
      sharpeRatio: 1.5,
      winRate: 0.6,
      totalTrades: 10,
      format: 'table' as const,
    };

    const result = await storeRunDuckdbHandler(args, mockCtx);

    expect(mockEngine.runDuckDBStorage).toHaveBeenCalledWith({
      duckdbPath: '/path/to/sim.duckdb',
      operation: 'store_run',
      data: {
        run_id: 'run123',
        strategy_id: 'PT2_SL25',
        mint: 'So11111111111111111111111111111111111111112',
        alert_timestamp: '2024-01-01T00:00:00Z',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-02T00:00:00Z',
        initial_capital: 1000.0,
        final_capital: 1200.0,
        total_return_pct: 20.0,
        max_drawdown_pct: 5.0,
        sharpe_ratio: 1.5,
        win_rate: 0.6,
        total_trades: 10,
      },
    });
    expect(result.success).toBe(true);
  });

  it('should handle optional fields', async () => {
    vi.mocked(mockEngine.runDuckDBStorage).mockResolvedValue({
      success: true,
      run_id: 'run123',
    });

    const args = {
      duckdb: '/path/to/sim.duckdb',
      runId: 'run123',
      strategyId: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alertTimestamp: '2024-01-01T00:00:00Z',
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-02T00:00:00Z',
      initialCapital: 1000.0,
      format: 'table' as const,
    };

    await storeRunDuckdbHandler(args, mockCtx);

    const callArgs = vi.mocked(mockEngine.runDuckDBStorage).mock.calls[0][0];
    expect(callArgs.duckdbPath).toBe('/path/to/sim.duckdb');
    expect(callArgs.operation).toBe('store_run');
    expect(callArgs.data.run_id).toBe('run123');
    expect(callArgs.data.strategy_id).toBe('PT2_SL25');
    expect(callArgs.data.mint).toBe('So11111111111111111111111111111111111111112');
    expect(callArgs.data.initial_capital).toBe(1000.0);
    // total_trades has a default, so it should be included if provided
    // Optional fields should not be present
    expect(callArgs.data.final_capital).toBeUndefined();
    expect(callArgs.data.total_return_pct).toBeUndefined();
    expect(callArgs.data.max_drawdown_pct).toBeUndefined();
    expect(callArgs.data.sharpe_ratio).toBeUndefined();
    expect(callArgs.data.win_rate).toBeUndefined();
  });
});
