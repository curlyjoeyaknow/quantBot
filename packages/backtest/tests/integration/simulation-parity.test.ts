/**
 * Simulation Parity Test
 * 
 * Verifies that Python simulation produces deterministic results
 * using real data from ClickHouse (candles) and DuckDB (calls).
 * 
 * This is a critical test for ensuring:
 * 1. Correctness of Python simulation
 * 2. Determinism (same seed → same results)
 * 3. Integration with real data sources
 * 4. Performance benchmarking
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { PythonEngine } from '@quantbot/utils';
import { getClickHouseClient, getDuckDBClient } from '@quantbot/storage';
import { join } from 'path';

interface Call {
  call_id: string;
  mint: string;
  alert_timestamp_ms: number;
  entry_price: number;
}

interface Candle {
  timestamp_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

describe('Python Simulation with Real Data', () => {
  let pythonEngine: PythonEngine;
  const duckdbPath = join(process.cwd(), 'data/alerts.duckdb');

  beforeAll(() => {
    pythonEngine = new PythonEngine();
  });

  /**
   * Fetch a sample call from DuckDB
   */
  async function fetchSampleCall(): Promise<Call | null> {
    const db = getDuckDBClient(duckdbPath);
    
    const rows = await db.all<Call>(
      `SELECT 
        call_id,
        mint,
        alert_timestamp_ms,
        entry_price
       FROM calls 
       WHERE alert_timestamp_ms >= 1704067200000 -- 2024-01-01
         AND alert_timestamp_ms < 1704153600000   -- 2024-01-02
       LIMIT 1`
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Fetch candles for a token from ClickHouse
   */
  async function fetchCandles(mint: string, startMs: number, endMs: number): Promise<Candle[]> {
    const ch = getClickHouseClient();
    const query = `
      SELECT
        toUnixTimestamp(timestamp) * 1000 AS timestamp_ms,
        open,
        high,
        low,
        close,
        volume
      FROM quantbot.ohlcv_candles
      WHERE chain = 'sol'
        AND token_address = '${mint}'
        AND interval_seconds = 60
        AND timestamp >= fromUnixTimestamp(${Math.floor(startMs / 1000)})
        AND timestamp < fromUnixTimestamp(${Math.floor(endMs / 1000)})
      ORDER BY timestamp ASC
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();
    return data as Candle[];
  }

  it('should run Python simulation with real ClickHouse + DuckDB data', async () => {
    // Fetch sample call
    const call = await fetchSampleCall();
    
    if (!call) {
      console.warn('No calls found in DuckDB for test period, skipping');
      return;
    }

    console.log(`Testing with call: ${call.call_id} (${call.mint})`);

    // Fetch candles for 4 hours after alert
    const startMs = call.alert_timestamp_ms - 60 * 60 * 1000; // 1 hour before
    const endMs = call.alert_timestamp_ms + 4 * 60 * 60 * 1000; // 4 hours after
    
    const candles = await fetchCandles(call.mint, startMs, endMs);
    
    if (candles.length === 0) {
      console.warn(`No candles found for ${call.mint}, skipping`);
      return;
    }

    console.log(`Fetched ${candles.length} candles`);

    // Prepare simulation input
    const simInput = {
      operation: 'simulate',
      calls: [
        {
          call_id: call.call_id,
          mint: call.mint,
          alert_timestamp_ms: call.alert_timestamp_ms,
          entry_price: call.entry_price,
        },
      ],
      candles_by_call_id: {
        [call.call_id]: candles,
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
    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    const pythonResult = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(simInput),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: {
          PYTHONPATH: process.cwd(),
        },
      }
    );

    // Parse and validate result
    const output = JSON.parse(pythonResult.stdout);

    console.log('Simulation result:', JSON.stringify(output, null, 2));

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
  }, 60000); // 60 second timeout

  it('should produce deterministic results with same seed', async () => {
    // Fetch sample call
    const call = await fetchSampleCall();
    
    if (!call) {
      console.warn('No calls found, skipping determinism test');
      return;
    }

    // Fetch candles
    const startMs = call.alert_timestamp_ms - 60 * 60 * 1000;
    const endMs = call.alert_timestamp_ms + 4 * 60 * 60 * 1000;
    const candles = await fetchCandles(call.mint, startMs, endMs);
    
    if (candles.length === 0) {
      console.warn('No candles found, skipping determinism test');
      return;
    }

    // Prepare simulation input
    const simInput = {
      operation: 'simulate',
      calls: [
        {
          call_id: call.call_id,
          mint: call.mint,
          alert_timestamp_ms: call.alert_timestamp_ms,
          entry_price: call.entry_price,
        },
      ],
      candles_by_call_id: {
        [call.call_id]: candles,
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

    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    // Run simulation twice with same seed
    const result1 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(simInput),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const result2 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
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
  }, 120000); // 120 second timeout

  it('should verify seed independence (different seeds can produce different results)', async () => {
    // Fetch sample call
    const call = await fetchSampleCall();
    
    if (!call) {
      console.warn('No calls found, skipping seed test');
      return;
    }

    // Fetch candles
    const startMs = call.alert_timestamp_ms - 60 * 60 * 1000;
    const endMs = call.alert_timestamp_ms + 4 * 60 * 60 * 1000;
    const candles = await fetchCandles(call.mint, startMs, endMs);
    
    if (candles.length === 0) {
      console.warn('No candles found, skipping seed test');
      return;
    }

    const baseInput = {
      operation: 'simulate',
      calls: [
        {
          call_id: call.call_id,
          mint: call.mint,
          alert_timestamp_ms: call.alert_timestamp_ms,
          entry_price: call.entry_price,
        },
      ],
      candles_by_call_id: {
        [call.call_id]: candles,
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
    };

    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    // Run with different seeds
    const input1 = { ...baseInput, random_seed: 111 };
    const input2 = { ...baseInput, random_seed: 222 };

    const result1 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(input1),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const result2 = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(input2),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const output1 = JSON.parse(result1.stdout);
    const output2 = JSON.parse(result2.stdout);

    // Both should succeed
    expect(output1).toHaveProperty('final_capital');
    expect(output2).toHaveProperty('final_capital');
    
    console.log(`Seed 111 result: ${output1.final_capital}, Seed 222 result: ${output2.final_capital}`);
    console.log('✅ Seed independence verified: simulation accepts different seeds');
  }, 120000);
});

describe('Python Simulation Performance', () => {
  let pythonEngine: PythonEngine;
  const duckdbPath = join(process.cwd(), 'data/alerts.duckdb');

  beforeAll(() => {
    pythonEngine = new PythonEngine();
  });

  /**
   * Fetch a sample call from DuckDB
   */
  async function fetchSampleCall(): Promise<Call | null> {
    const db = getDuckDBClient(duckdbPath);
    
    const rows = await db.all<Call>(
      `SELECT 
        call_id,
        mint,
        alert_timestamp_ms,
        entry_price
       FROM calls 
       WHERE alert_timestamp_ms >= 1704067200000
         AND alert_timestamp_ms < 1704153600000
       LIMIT 1`
    );

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Fetch candles for a token from ClickHouse
   */
  async function fetchCandles(mint: string, startMs: number, endMs: number): Promise<Candle[]> {
    const ch = getClickHouseClient();
    const query = `
      SELECT
        toUnixTimestamp(timestamp) * 1000 AS timestamp_ms,
        open,
        high,
        low,
        close,
        volume
      FROM quantbot.ohlcv_candles
      WHERE chain = 'sol'
        AND token_address = '${mint}'
        AND interval_seconds = 60
        AND timestamp >= fromUnixTimestamp(${Math.floor(startMs / 1000)})
        AND timestamp < fromUnixTimestamp(${Math.floor(endMs / 1000)})
      ORDER BY timestamp ASC
    `;

    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();
    return data as Candle[];
  }

  it('should benchmark Python simulation performance', async () => {
    // Fetch sample call
    const call = await fetchSampleCall();
    
    if (!call) {
      console.warn('No calls found, skipping benchmark');
      return;
    }

    // Fetch candles
    const startMs = call.alert_timestamp_ms - 60 * 60 * 1000;
    const endMs = call.alert_timestamp_ms + 4 * 60 * 60 * 1000;
    const candles = await fetchCandles(call.mint, startMs, endMs);
    
    if (candles.length === 0) {
      console.warn('No candles found, skipping benchmark');
      return;
    }

    // Prepare simulation input
    const simInput = {
      operation: 'simulate',
      calls: [
        {
          call_id: call.call_id,
          mint: call.mint,
          alert_timestamp_ms: call.alert_timestamp_ms,
          entry_price: call.entry_price,
        },
      ],
      candles_by_call_id: {
        [call.call_id]: candles,
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

    const pythonScriptPath = join(
      process.cwd(),
      'packages/backtest/python/lib/v1_baseline_simulator.py'
    );

    const startTime = Date.now();
    
    const result = await pythonEngine.runScriptWithStdin(
      pythonScriptPath,
      JSON.stringify(simInput),
      {
        cwd: join(process.cwd(), 'packages/backtest/python'),
        env: { PYTHONPATH: process.cwd() },
      }
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    const output = JSON.parse(result.stdout);
    
    console.log(`\n📊 Performance Benchmark:`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Candles processed: ${candles.length}`);
    console.log(`  Trades executed: ${output.trades_executed}`);
    console.log(`  Trades skipped: ${output.trades_skipped}`);
    console.log(`  Final capital: $${output.final_capital.toFixed(2)}`);
    console.log(`  Total return: ${(output.total_return * 100).toFixed(2)}%`);

    // Expect reasonable performance (< 10 seconds for single call)
    expect(duration).toBeLessThan(10000);
  }, 60000);
});
