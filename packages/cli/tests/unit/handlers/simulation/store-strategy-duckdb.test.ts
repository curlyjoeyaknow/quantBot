/**
 * Unit tests for store-strategy-duckdb handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { storeStrategyDuckdbHandler } from '../../../../src/handlers/simulation/store-strategy-duckdb.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import type { PythonEngine } from '@quantbot/utils';

describe('storeStrategyDuckdbHandler', () => {
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

    expect(mockEngine.runDuckDBStorage).toHaveBeenCalledWith({
      duckdbPath: '/path/to/sim.duckdb',
      operation: 'store_strategy',
      data: {
        strategy_id: 'PT2_SL25',
        name: 'PT2 SL25',
        entry_config: { type: 'immediate' },
        exit_config: { targets: [{ target: 2.0, percent: 0.5 }] },
        reentry_config: undefined,
        cost_config: undefined,
      },
    });
    expect(result.success).toBe(true);
  });

  it('should handle optional configs', async () => {
    vi.mocked(mockEngine.runDuckDBStorage).mockResolvedValue({
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

    expect(mockEngine.runDuckDBStorage).toHaveBeenCalledWith({
      duckdbPath: '/path/to/sim.duckdb',
      operation: 'store_strategy',
      data: {
        strategy_id: 'PT2_SL25',
        name: 'PT2 SL25',
        entry_config: { type: 'immediate' },
        exit_config: { targets: [] },
        reentry_config: { enabled: true },
        cost_config: { maker_fee: 0.001 },
      },
    });
  });

  it('should propagate errors from PythonEngine', async () => {
    const error = new Error('DuckDB operation failed');
    vi.mocked(mockEngine.runDuckDBStorage).mockRejectedValue(error);

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
