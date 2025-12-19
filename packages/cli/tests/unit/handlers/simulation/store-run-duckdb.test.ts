/**
 * Unit tests for store-run-duckdb handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeRunDuckdbHandler } from '../../../../src/handlers/simulation/store-run-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('storeRunDuckdbHandler', () => {
  let mockDuckDBStorage: { storeRun: ReturnType<typeof vi.fn> };
  let mockCtx: CommandContext;

  beforeEach(() => {
    // Mock DuckDBStorageService
    mockDuckDBStorage = {
      storeRun: vi.fn(),
    };

    mockCtx = {
      services: {
        duckdbStorage: () => mockDuckDBStorage as any,
      },
    } as unknown as CommandContext;
  });

  it('should call PythonEngine with correct parameters', async () => {
    vi.mocked(mockDuckDBStorage.storeRun).mockResolvedValue({
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

    expect(mockDuckDBStorage.storeRun).toHaveBeenCalledWith(
      '/path/to/sim.duckdb',
      'run123',
      'PT2_SL25',
      'PT2_SL25', // strategyName (uses strategyId as fallback)
      'So11111111111111111111111111111111111111112',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
      '2024-01-02T00:00:00Z',
      1000.0,
      { entry: {}, exit: {} }, // strategyConfig
      undefined, // callerName
      1200.0, // finalCapital
      20.0, // totalReturnPct
      5.0, // maxDrawdownPct
      1.5, // sharpeRatio
      0.6, // winRate
      10 // totalTrades
    );
    expect(result.success).toBe(true);
  });

  it('should handle optional fields', async () => {
    vi.mocked(mockDuckDBStorage.storeRun).mockResolvedValue({
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

    expect(mockDuckDBStorage.storeRun).toHaveBeenCalledWith(
      '/path/to/sim.duckdb',
      'run123',
      'PT2_SL25',
      'PT2_SL25', // strategyName (uses strategyId as fallback)
      'So11111111111111111111111111111111111111112',
      '2024-01-01T00:00:00Z',
      '2024-01-01T00:00:00Z',
      '2024-01-02T00:00:00Z',
      1000.0,
      { entry: {}, exit: {} }, // strategyConfig
      undefined, // callerName
      undefined, // finalCapital
      undefined, // totalReturnPct
      undefined, // maxDrawdownPct
      undefined, // sharpeRatio
      undefined, // winRate
      undefined // totalTrades
    );
  });
});
