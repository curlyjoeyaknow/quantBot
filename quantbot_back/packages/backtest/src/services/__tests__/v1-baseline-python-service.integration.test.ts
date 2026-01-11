/**
 * V1 Baseline Python Service Integration Tests
 *
 * Tests the TypeScript → Python integration flow.
 */

import { describe, it, expect } from 'vitest';
import { PythonEngine } from '@quantbot/utils';
import { V1BaselinePythonService } from '../v1-baseline-python-service.js';

describe('V1BaselinePythonService Integration', () => {
  const pythonEngine = new PythonEngine();
  const service = new V1BaselinePythonService(pythonEngine);

  it('should simulate capital-aware trade with Python', async () => {
    const result = await service.simulateCapitalAware({
      calls: [
        {
          id: 'test1',
          mint: 'TOKEN_A',
          caller: 'Test',
          ts_ms: 1735689600000,
        },
      ],
      candles_by_call_id: {
        test1: [
          {
            timestamp: 1735689600, // seconds
            open: 1.0,
            high: 1.05,
            low: 0.95,
            close: 1.0,
            volume: 1000,
          },
          {
            timestamp: 1735689660, // 1 minute later
            open: 1.0,
            high: 2.5,
            low: 0.95,
            close: 2.3,
            volume: 1000,
          },
        ],
      },
      params: {
        tp_mult: 2.0,
        sl_mult: 0.85,
      },
    });

    expect(result).toBeDefined();
    expect(result.final_capital).toBeGreaterThan(10000); // Should be profitable
    expect(result.trades_executed).toBe(1);
    expect(result.completed_trades).toHaveLength(1);
    expect(result.completed_trades[0].exit_reason).toBe('take_profit');
  }, 30000); // 30s timeout for Python execution

  it('should optimize V1 baseline parameters with Python', async () => {
    const result = await service.optimizeV1Baseline({
      calls: [
        {
          id: 'test1',
          mint: 'TOKEN_A',
          caller: 'Test',
          ts_ms: 1735689600000,
        },
      ],
      candles_by_call_id: {
        test1: [
          {
            timestamp: 1735689600,
            open: 1.0,
            high: 1.05,
            low: 0.95,
            close: 1.0,
            volume: 1000,
          },
          {
            timestamp: 1735689660,
            open: 1.0,
            high: 2.5,
            low: 0.95,
            close: 2.3,
            volume: 1000,
          },
        ],
      },
      param_grid: {
        tp_mults: [1.5, 2.0],
        sl_mults: [0.85, 0.9],
        max_hold_hrs: [48.0],
      },
    });

    expect(result).toBeDefined();
    expect(result.best_params).toBeDefined();
    expect(result.params_evaluated).toBe(4); // 2 * 2 * 1
    expect(result.best_final_capital).toBeGreaterThan(10000);
  }, 60000); // 60s timeout for optimization

  it('should optimize per caller with Python', async () => {
    const result = await service.optimizeV1BaselinePerCaller({
      calls: [
        {
          id: 'test1',
          mint: 'TOKEN_A',
          caller: 'CallerA',
          ts_ms: 1735689600000,
        },
        {
          id: 'test2',
          mint: 'TOKEN_B',
          caller: 'CallerB',
          ts_ms: 1735689700000,
        },
      ],
      candles_by_call_id: {
        test1: [
          {
            timestamp: 1735689600,
            open: 1.0,
            high: 2.5,
            low: 0.95,
            close: 2.3,
            volume: 1000,
          },
        ],
        test2: [
          {
            timestamp: 1735689700,
            open: 1.0,
            high: 1.5,
            low: 0.95,
            close: 1.4,
            volume: 1000,
          },
        ],
      },
      param_grid: {
        tp_mults: [1.5, 2.0],
        sl_mults: [0.85, 0.9],
        max_hold_hrs: [48.0],
      },
    });

    expect(result).toBeDefined();
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['CallerA']).toBeDefined();
    expect(result['CallerB']).toBeDefined();
    expect(result['CallerA'].best_params).toBeDefined();
    expect(result['CallerB'].best_params).toBeDefined();
  }, 60000);

  it('should run grouped evaluation with Python', async () => {
    const result = await service.runV1BaselineGroupedEvaluation({
      calls: [
        {
          id: 'test1',
          mint: 'TOKEN_A',
          caller: 'CallerA',
          ts_ms: 1735689600000,
        },
        {
          id: 'test2',
          mint: 'TOKEN_B',
          caller: 'CallerB',
          ts_ms: 1735689700000,
        },
      ],
      candles_by_call_id: {
        test1: [
          {
            timestamp: 1735689600,
            open: 1.0,
            high: 2.5,
            low: 0.95,
            close: 2.3,
            volume: 1000,
          },
        ],
        test2: [
          {
            timestamp: 1735689700,
            open: 1.0,
            high: 1.5,
            low: 0.95,
            close: 1.4,
            volume: 1000,
          },
        ],
      },
      param_grid: {
        tp_mults: [1.5, 2.0],
        sl_mults: [0.85, 0.9],
        max_hold_hrs: [48.0],
      },
      filter_collapsed: true,
      filter_extreme: true,
    });

    expect(result).toBeDefined();
    expect(result.per_caller_results).toBeDefined();
    expect(result.selected_callers).toBeDefined();
    expect(Array.isArray(result.selected_callers)).toBe(true);
  }, 60000);
});

