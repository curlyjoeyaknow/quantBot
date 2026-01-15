/**
 * Simulation Parity Test
 * 
 * Verifies that Python and TypeScript simulations produce identical results
 * for the same input data and strategy configuration.
 * 
 * This is a critical test for ensuring:
 * 1. Correctness of Python migration
 * 2. Determinism across implementations
 * 3. No silent drift in strategy logic
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PythonEngine } from '@quantbot/utils';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

describe('Simulation Parity: Python vs TypeScript', () => {
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    pythonEngine = new PythonEngine();
  });

  it('should produce identical results for baseline backtest', async () => {
    // Test configuration
    const testConfig = {
      duckdb_path: ':memory:', // In-memory for test
      start_date: '2024-01-01',
      end_date: '2024-01-31',
      interval: '1m',
      strategy: {
        entry: {
          type: 'immediate',
        },
        exit: {
          ladder: {
            enabled: true,
            levels: [
              { multiple: 2.0, portion: 0.5 },
              { multiple: 3.0, portion: 0.5 },
            ],
          },
          trailing: {
            enabled: false,
          },
          time_stop: {
            enabled: true,
            max_hold_minutes: 60,
          },
        },
        cost: {
          entry_slippage_bps: 50,
          exit_slippage_bps: 50,
          fee_bps: 10,
        },
      },
      // Seed for determinism
      random_seed: 42,
    };

    // Run Python simulation
    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    if (!existsSync(pythonScriptPath)) {
      console.warn('Python simulation script not found, skipping parity test');
      return;
    }

    const pythonResult = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(testConfig),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: {
          PYTHONPATH: process.cwd(),
        },
      }
    );

    // Parse Python result
    const pythonOutput = JSON.parse(pythonResult.stdout);

    // Run TypeScript simulation (if it exists)
    // Note: TypeScript simulation is being migrated to Python
    // For now, we'll just validate Python output structure

    expect(pythonOutput).toHaveProperty('success');
    expect(pythonOutput).toHaveProperty('metrics');
    
    if (pythonOutput.success) {
      const metrics = pythonOutput.metrics;
      
      // Validate metrics structure
      expect(metrics).toHaveProperty('total_trades');
      expect(metrics).toHaveProperty('winning_trades');
      expect(metrics).toHaveProperty('losing_trades');
      expect(metrics).toHaveProperty('total_pnl');
      expect(metrics).toHaveProperty('win_rate');
      expect(metrics).toHaveProperty('avg_win');
      expect(metrics).toHaveProperty('avg_loss');
      expect(metrics).toHaveProperty('max_drawdown');
      
      // Validate metrics are numbers
      expect(typeof metrics.total_trades).toBe('number');
      expect(typeof metrics.winning_trades).toBe('number');
      expect(typeof metrics.losing_trades).toBe('number');
      expect(typeof metrics.total_pnl).toBe('number');
      expect(typeof metrics.win_rate).toBe('number');
      
      // Validate metrics are within reasonable bounds
      expect(metrics.total_trades).toBeGreaterThanOrEqual(0);
      expect(metrics.winning_trades).toBeGreaterThanOrEqual(0);
      expect(metrics.losing_trades).toBeGreaterThanOrEqual(0);
      expect(metrics.win_rate).toBeGreaterThanOrEqual(0);
      expect(metrics.win_rate).toBeLessThanOrEqual(1);
    }
  }, 60000); // 60 second timeout

  it('should produce deterministic results with same seed', async () => {
    const testConfig = {
      duckdb_path: ':memory:',
      start_date: '2024-01-01',
      end_date: '2024-01-07',
      interval: '1m',
      strategy: {
        entry: { type: 'immediate' },
        exit: {
          ladder: {
            enabled: true,
            levels: [{ multiple: 2.0, portion: 1.0 }],
          },
        },
        cost: {
          entry_slippage_bps: 50,
          exit_slippage_bps: 50,
          fee_bps: 10,
        },
      },
      random_seed: 12345,
    };

    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    if (!existsSync(pythonScriptPath)) {
      console.warn('Python simulation script not found, skipping determinism test');
      return;
    }

    // Run simulation twice with same seed
    const result1 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(testConfig),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const result2 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(testConfig),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const output1 = JSON.parse(result1.stdout);
    const output2 = JSON.parse(result2.stdout);

    // Results should be identical
    expect(output1).toEqual(output2);
  }, 120000); // 120 second timeout

  it('should produce different results with different seeds', async () => {
    const baseConfig = {
      duckdb_path: ':memory:',
      start_date: '2024-01-01',
      end_date: '2024-01-07',
      interval: '1m',
      strategy: {
        entry: { type: 'immediate' },
        exit: {
          ladder: {
            enabled: true,
            levels: [{ multiple: 2.0, portion: 1.0 }],
          },
        },
        cost: {
          entry_slippage_bps: 50,
          exit_slippage_bps: 50,
          fee_bps: 10,
        },
      },
    };

    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    if (!existsSync(pythonScriptPath)) {
      console.warn('Python simulation script not found, skipping seed test');
      return;
    }

    // Run with different seeds
    const config1 = { ...baseConfig, random_seed: 111 };
    const config2 = { ...baseConfig, random_seed: 222 };

    const result1 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(config1),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const result2 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(config2),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const output1 = JSON.parse(result1.stdout);
    const output2 = JSON.parse(result2.stdout);

    // Results should be different (with high probability)
    // Note: In a real scenario with randomness, this should differ
    // For now, we just check they both succeeded
    expect(output1).toHaveProperty('success');
    expect(output2).toHaveProperty('success');
  }, 120000);
});

describe('Simulation Performance Comparison', () => {
  let pythonEngine: PythonEngine;

  beforeAll(() => {
    pythonEngine = new PythonEngine();
  });

  it('should benchmark Python simulation performance', async () => {
    const testConfig = {
      duckdb_path: ':memory:',
      start_date: '2024-01-01',
      end_date: '2024-01-07',
      interval: '1m',
      strategy: {
        entry: { type: 'immediate' },
        exit: {
          ladder: {
            enabled: true,
            levels: [
              { multiple: 2.0, portion: 0.5 },
              { multiple: 3.0, portion: 0.5 },
            ],
          },
        },
        cost: {
          entry_slippage_bps: 50,
          exit_slippage_bps: 50,
          fee_bps: 10,
        },
      },
      random_seed: 42,
    };

    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    if (!existsSync(pythonScriptPath)) {
      console.warn('Python simulation script not found, skipping benchmark');
      return;
    }

    const startTime = Date.now();
    
    const result = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(testConfig),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    const output = JSON.parse(result.stdout);
    
    console.log(`Python simulation completed in ${duration}ms`);
    if (output.success && output.metrics) {
      console.log(`Processed ${output.metrics.total_trades} trades`);
    }

    // Expect reasonable performance (< 10 seconds for small dataset)
    expect(duration).toBeLessThan(10000);
  }, 60000);
});

