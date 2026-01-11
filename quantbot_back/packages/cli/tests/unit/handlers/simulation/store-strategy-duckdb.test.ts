/**
 * Unit tests for store-strategy-duckdb handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeStrategyDuckdbHandler } from '../../../../src/commands/simulation/store-strategy-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('storeStrategyDuckdbHandler', () => {
  let mockDuckDBStorage: { storeStrategy: ReturnType<typeof vi.fn> };
  let mockCtx: CommandContext;

  beforeEach(() => {
    // Mock DuckDBStorageService
    mockDuckDBStorage = {
      storeStrategy: vi.fn(),
    };

    mockCtx = {
      services: {
        duckdbStorage: () => mockDuckDBStorage as any,
      },
    } as unknown as CommandContext;
  });

  it('should call PythonEngine with correct parameters', async () => {
    vi.mocked(mockDuckDBStorage.storeStrategy).mockResolvedValue({
      success: true,
      strategy_id: 'PT2_SL25',
    });

    const args = {
      duckdb: '/path/to/sim.duckdb',
      strategyId: 'PT2_SL25',
      name: 'PT2 SL25',
      entryConfig: { type: 'immediate' },
      exitConfig: { targets: [{ target: 2.0, percent: 0.5 }] },
      reentryConfig: undefined,
      costConfig: undefined,
      format: 'table' as const,
    };

    const result = await storeStrategyDuckdbHandler(args, mockCtx);

    expect(mockDuckDBStorage.storeStrategy).toHaveBeenCalledWith(
      '/path/to/sim.duckdb',
      'PT2_SL25',
      'PT2 SL25',
      { type: 'immediate' },
      { targets: [{ target: 2.0, percent: 0.5 }] },
      undefined,
      undefined
    );
    expect(result.success).toBe(true);
  });

  it('should handle optional configs', async () => {
    vi.mocked(mockDuckDBStorage.storeStrategy).mockResolvedValue({
      success: true,
      strategy_id: 'PT2_SL25',
    });

    const args = {
      duckdb: '/path/to/sim.duckdb',
      strategyId: 'PT2_SL25',
      name: 'PT2 SL25',
      entryConfig: { type: 'immediate' },
      exitConfig: { targets: [] },
      reentryConfig: { enabled: true },
      costConfig: { maker_fee: 0.001 },
      format: 'table' as const,
    };

    await storeStrategyDuckdbHandler(args, mockCtx);

    expect(mockDuckDBStorage.storeStrategy).toHaveBeenCalledWith(
      '/path/to/sim.duckdb',
      'PT2_SL25',
      'PT2 SL25',
      { type: 'immediate' },
      { targets: [] },
      { enabled: true },
      { maker_fee: 0.001 }
    );
  });

  it('should propagate errors from PythonEngine', async () => {
    const error = new Error('DuckDB operation failed');
    vi.mocked(mockDuckDBStorage.storeStrategy).mockRejectedValue(error);

    const args = {
      duckdb: '/path/to/sim.duckdb',
      strategyId: 'PT2_SL25',
      name: 'PT2 SL25',
      entryConfig: {},
      exitConfig: {},
      format: 'table' as const,
    };

    await expect(storeStrategyDuckdbHandler(args, mockCtx)).rejects.toThrow(
      'DuckDB operation failed'
    );
  });
});
