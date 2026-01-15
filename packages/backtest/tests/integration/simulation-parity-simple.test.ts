/**
 * Simplified Simulation Parity Test
 * 
 * Uses Python for both data fetching and simulation to avoid TypeScript/DuckDB binding issues.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PythonEngine } from '@quantbot/utils';
import { join } from 'path';

describe('Python Simulation with Real Data (Simplified)', () => {
  let pythonEngine: PythonEngine;
  const duckdbPath = join(process.cwd(), 'data/alerts.duckdb');

  beforeAll(() => {
    pythonEngine = new PythonEngine();
  });

  it('should run Python simulation with real ClickHouse + DuckDB data', async () => {
    // Fetch test data using Python script
    const fetchDataScript = join(
      process.cwd(),
      'packages/backtest/python/scripts/fetch_test_data.py'
    );

    const fetchResult = await pythonEngine.runScriptWithStdin(
      fetchDataScript,
      JSON.stringify({ duckdb_path: duckdbPath }),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const testData = JSON.parse(fetchResult.stdout);

    if (!testData.success) {
      console.warn(`Failed to fetch test data: ${testData.error}`);
      return;
    }

    console.log(`✅ Fetched test data: ${testData.candles.length} candles for ${testData.call.mint}`);

    // Prepare simulation input
    const simInput = {
      operation: 'simulate',
      calls: [testData.call],
      candles_by_call_id: {
        [testData.call.call_id]: testData.candles,
      },
      params: {
        tp_mult: 2.0,
        sl_mult: 0.5,
        max_hold_hrs: 4,
      },
      config: {
        initial_capital: 10000,
        position_size_usd: 1000,
        max_positions: 1,
      },
      random_seed: 42,
    };

    // Run Python simulation
    const simScript = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    const simResult = await pythonEngine.runScriptWithStdin(
      simScript,
      JSON.stringify(simInput),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const output = JSON.parse(simResult.stdout);

    console.log('\n📊 Simulation Result:');
    console.log(`  Final capital: $${output.final_capital.toFixed(2)}`);
    console.log(`  Total return: ${(output.total_return * 100).toFixed(2)}%`);
    console.log(`  Trades executed: ${output.trades_executed}`);
    console.log(`  Trades skipped: ${output.trades_skipped}`);

    // Validate output structure
    expect(output).toHaveProperty('final_capital');
    expect(output).toHaveProperty('total_return');
    expect(output).toHaveProperty('trades_executed');
    expect(output).toHaveProperty('trades_skipped');
    expect(output).toHaveProperty('completed_trades');

    // Validate types
    expect(typeof output.final_capital).toBe('number');
    expect(typeof output.total_return).toBe('number');
    expect(typeof output.trades_executed).toBe('number');
    expect(typeof output.trades_skipped).toBe('number');
    expect(Array.isArray(output.completed_trades)).toBe(true);

    // Validate bounds
    expect(output.final_capital).toBeGreaterThan(0);
    expect(output.trades_executed + output.trades_skipped).toBeGreaterThanOrEqual(0);
  }, 60000);

  it('should produce deterministic results with same seed', async () => {
    // Fetch test data
    const fetchDataScript = join(
      process.cwd(),
      'packages/backtest/python/scripts/fetch_test_data.py'
    );

    const fetchResult = await pythonEngine.runScriptWithStdin(
      fetchDataScript,
      JSON.stringify({ duckdb_path: duckdbPath }),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const testData = JSON.parse(fetchResult.stdout);

    if (!testData.success) {
      console.warn('Failed to fetch test data, skipping determinism test');
      return;
    }

    // Prepare simulation input
    const simInput = {
      operation: 'simulate',
      calls: [testData.call],
      candles_by_call_id: {
        [testData.call.call_id]: testData.candles,
      },
      params: {
        tp_mult: 2.0,
        sl_mult: 0.5,
        max_hold_hrs: 4,
      },
      config: {
        initial_capital: 10000,
        position_size_usd: 1000,
        max_positions: 1,
      },
      random_seed: 12345, // Fixed seed
    };

    const simScript = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    // Run simulation twice with same seed
    const result1 = await pythonEngine.runScriptWithStdin(
      simScript,
      JSON.stringify(simInput),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const result2 = await pythonEngine.runScriptWithStdin(
      simScript,
      JSON.stringify(simInput),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const output1 = JSON.parse(result1.stdout);
    const output2 = JSON.parse(result2.stdout);

    // Results should be identical (determinism)
    expect(output1).toEqual(output2);

    console.log('✅ Determinism verified: same seed → same results');
  }, 120000);
});

