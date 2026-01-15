/**
 * TypeScript-Python Parity Tests
 *
 * Compares outputs from TypeScript simulation package and Python backtest package
 * to ensure they produce identical results.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { simulateCapitalAware } from '../../src/optimization/capital-simulator.js';
import type {
  V1BaselineParams,
  CapitalSimulatorConfig,
  CapitalSimulationResult,
} from '../../src/optimization/capital-simulator.js';
import type { CallRecord } from '../../src/types.js';
import type { Candle } from '@quantbot/core';
import { PythonEngine } from '@quantbot/utils';
import {
  V1BaselinePythonService,
  type SimulateCapitalAwareConfig,
} from '../../src/services/v1-baseline-python-service.js';

/**
 * Helper to create a test candle
 */
function makeCandle(tsMs: number, open: number, high: number, low: number, close: number): Candle {
  return {
    timestamp: tsMs / 1000, // Convert to seconds
    open,
    high,
    low,
    close,
    volume: 1000,
  };
}

/**
 * Helper to create a test call record
 */
function makeCall(id: string, mint: string, caller: string, tsMs: number): CallRecord {
  return {
    id,
    mint,
    caller,
    createdAt: DateTime.fromMillis(tsMs),
  };
}

/**
 * Run Python simulator and parse result
 */
async function runPythonSimulator(
  calls: Array<{ id: string; mint: string; caller: string; ts_ms: number }>,
  candlesByCallId: Record<
    string,
    Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>
  >,
  params: V1BaselineParams,
  config?: CapitalSimulatorConfig
): Promise<CapitalSimulationResult> {
  const pythonEngine = new PythonEngine();
  const service = new V1BaselinePythonService(pythonEngine);

  // Convert params to match Python service format (snake_case)
  const pythonParams = {
    tp_mult: params.tp_mult,
    sl_mult: params.sl_mult,
    max_hold_hrs: params.max_hold_hrs,
  };

  // Convert config to match Python service format (snake_case)
  const pythonConfig = config
    ? {
        initial_capital: config.initialCapital,
        max_allocation_pct: config.maxAllocationPct,
        max_risk_per_trade: config.maxRiskPerTrade,
        max_concurrent_positions: config.maxConcurrentPositions,
        max_trade_horizon_hrs: config.maxTradeHorizonHrs,
        min_executable_size: config.minExecutableSize,
        taker_fee_bps: config.fees?.takerFeeBps,
        slippage_bps: config.fees?.slippageBps,
      }
    : undefined;

  const simConfig: SimulateCapitalAwareConfig = {
    calls,
    candles_by_call_id: candlesByCallId,
    params: pythonParams,
    config: pythonConfig,
  };

  // Run Python simulation via service
  const pythonResult = await service.simulateCapitalAware(simConfig);

  // Convert Python result (snake_case) to TypeScript format (camelCase)
  return {
    finalCapital: pythonResult.final_capital,
    totalReturn: pythonResult.total_return,
    tradesExecuted: pythonResult.trades_executed,
    tradesSkipped: pythonResult.trades_skipped,
    completedTrades: pythonResult.completed_trades.map((t) => ({
      callId: t.call_id,
      entryTsMs: t.entry_ts_ms,
      exitTsMs: t.exit_ts_ms,
      entryPx: t.entry_px,
      exitPx: t.exit_px,
      size: t.size,
      pnl: t.pnl,
      exitReason: t.exit_reason,
      exitMult: t.exit_mult,
    })),
    finalState: {
      initialCapital: config?.initialCapital ?? 10_000,
      freeCash: pythonResult.final_capital, // Approximate
      totalCapital: pythonResult.final_capital,
      positions: new Map(),
      completedTrades: [],
    },
  };
}

describe('TypeScript-Python Parity Tests', () => {
  const baseTs = DateTime.fromISO('2025-01-01T00:00:00Z').toMillis();

  describe('Simple pump scenario', () => {
    it('should produce identical results for simple TP exit', async () => {
      // Create a simple pump: price goes 1.0 -> 3.0 -> 1.5, TP at 2.0
      const call = makeCall('call1', 'TOKEN_PUMP', 'GoldenCaller', baseTs);

      const candles: Candle[] = [];
      for (let i = 0; i < 60; i++) {
        const ts = baseTs + i * 60000; // 1 minute intervals
        let price: number;
        if (i < 30) {
          // Rising: 1.0 -> 3.0
          price = 1.0 + (2.0 * i) / 30;
        } else {
          // Falling: 3.0 -> 1.5
          price = 3.0 - (1.5 * (i - 30)) / 30;
        }
        candles.push(makeCandle(ts, price * 0.99, price * 1.01, price * 0.98, price));
      }

      const params: V1BaselineParams = {
        tp_mult: 2.0,
        sl_mult: 0.85,
      };

      const config: CapitalSimulatorConfig = {
        initialCapital: 10_000,
      };

      // Run TypeScript simulation
      const tsCalls = [call];
      const tsCandlesByCallId = new Map<string, Candle[]>();
      tsCandlesByCallId.set(call.id, candles);
      const tsResult = simulateCapitalAware(tsCalls, tsCandlesByCallId, params, config);

      // Run Python simulation
      const pyCalls = [
        { id: call.id, mint: call.mint, caller: call.caller, ts_ms: call.createdAt.toMillis() },
      ];
      const pyCandlesByCallId: Record<string, Candle[]> = {};
      pyCandlesByCallId[call.id] = candles;
      const pyResult = await runPythonSimulator(pyCalls, pyCandlesByCallId, params, config);

      // Compare results
      expect(pyResult.tradesExecuted).toBe(tsResult.tradesExecuted);
      expect(pyResult.completedTrades.length).toBe(tsResult.completedTrades.length);

      if (tsResult.completedTrades.length > 0 && pyResult.completedTrades.length > 0) {
        const tsTrade = tsResult.completedTrades[0];
        const pyTrade = pyResult.completedTrades[0];

        expect(pyTrade.exitReason).toBe(tsTrade.exitReason);
        expect(pyTrade.exitPx).toBeCloseTo(tsTrade.exitPx, 2);
        expect(pyTrade.exitMult).toBeCloseTo(tsTrade.exitMult, 4);
        expect(pyTrade.size).toBeCloseTo(tsTrade.size, 1);
        expect(pyTrade.pnl).toBeCloseTo(tsTrade.pnl, 1);
      }

      // Final capital should match (within rounding tolerance)
      expect(pyResult.finalCapital).toBeCloseTo(tsResult.finalCapital, 1);
      expect(pyResult.totalReturn).toBeCloseTo(tsResult.totalReturn, 6);
    });
  });

  describe('Multiple calls scenario', () => {
    it('should produce identical results for multiple sequential calls', async () => {
      const calls = [
        makeCall('call1', 'TOKEN_A', 'Caller1', baseTs),
        makeCall('call2', 'TOKEN_B', 'Caller2', baseTs + 3600000), // 1 hour later
      ];

      // Create candles for call1: pump to 2.5x
      const candles1: Candle[] = [];
      for (let i = 0; i < 30; i++) {
        const ts = baseTs + i * 60000;
        const price = 1.0 + (1.5 * i) / 30; // 1.0 -> 2.5
        candles1.push(makeCandle(ts, price * 0.99, price * 1.01, price * 0.98, price));
      }

      // Create candles for call2: pump to 3x
      const candles2: Candle[] = [];
      for (let i = 0; i < 30; i++) {
        const ts = baseTs + 3600000 + i * 60000;
        const price = 1.0 + (2.0 * i) / 30; // 1.0 -> 3.0
        candles2.push(makeCandle(ts, price * 0.99, price * 1.01, price * 0.98, price));
      }

      const params: V1BaselineParams = {
        tp_mult: 2.0,
        sl_mult: 0.85,
      };

      const config: CapitalSimulatorConfig = {
        initialCapital: 10_000,
      };

      // Run TypeScript simulation
      const tsCandlesByCallId = new Map<string, Candle[]>();
      tsCandlesByCallId.set(calls[0].id, candles1);
      tsCandlesByCallId.set(calls[1].id, candles2);
      const tsResult = simulateCapitalAware(calls, tsCandlesByCallId, params, config);

      // Run Python simulation
      const pyCalls = calls.map((c) => ({
        id: c.id,
        mint: c.mint,
        caller: c.caller,
        ts_ms: c.createdAt.toMillis(),
      }));
      const pyCandlesByCallId: Record<string, Candle[]> = {
        [calls[0].id]: candles1,
        [calls[1].id]: candles2,
      };
      const pyResult = await runPythonSimulator(pyCalls, pyCandlesByCallId, params, config);

      // Compare results
      expect(pyResult.tradesExecuted).toBe(tsResult.tradesExecuted);
      expect(pyResult.completedTrades.length).toBe(tsResult.completedTrades.length);
      expect(pyResult.finalCapital).toBeCloseTo(tsResult.finalCapital, 1);
      expect(pyResult.totalReturn).toBeCloseTo(tsResult.totalReturn, 6);

      // Compare individual trades
      const sortedTsTrades = [...tsResult.completedTrades].sort(
        (a, b) => a.entryTsMs - b.entryTsMs
      );
      const sortedPyTrades = [...pyResult.completedTrades].sort(
        (a, b) => a.entryTsMs - b.entryTsMs
      );

      expect(sortedPyTrades.length).toBe(sortedTsTrades.length);

      for (let i = 0; i < sortedTsTrades.length; i++) {
        const tsTrade = sortedTsTrades[i];
        const pyTrade = sortedPyTrades[i];

        expect(pyTrade.callId).toBe(tsTrade.callId);
        expect(pyTrade.exitReason).toBe(tsTrade.exitReason);
        expect(pyTrade.exitPx).toBeCloseTo(tsTrade.exitPx, 2);
        expect(pyTrade.pnl).toBeCloseTo(tsTrade.pnl, 1);
      }
    });
  });

  describe('Stop loss scenario', () => {
    it('should produce identical results for SL exit', async () => {
      const call = makeCall('call_sl', 'TOKEN_SL', 'CallerSL', baseTs);

      // Create candles: price drops from 1.0 to 0.8 (SL at 0.85)
      const candles: Candle[] = [];
      for (let i = 0; i < 20; i++) {
        const ts = baseTs + i * 60000;
        const price = 1.0 - (0.2 * i) / 20; // 1.0 -> 0.8
        candles.push(makeCandle(ts, price * 1.01, price * 1.01, price * 0.99, price));
      }

      const params: V1BaselineParams = {
        tp_mult: 2.0,
        sl_mult: 0.85,
      };

      const config: CapitalSimulatorConfig = {
        initialCapital: 10_000,
      };

      // Run TypeScript simulation
      const tsCandlesByCallId = new Map<string, Candle[]>();
      tsCandlesByCallId.set(call.id, candles);
      const tsResult = simulateCapitalAware([call], tsCandlesByCallId, params, config);

      // Run Python simulation
      const pyCalls = [
        { id: call.id, mint: call.mint, caller: call.caller, ts_ms: call.createdAt.toMillis() },
      ];
      const pyCandlesByCallId: Record<string, Candle[]> = {};
      pyCandlesByCallId[call.id] = candles;
      const pyResult = await runPythonSimulator(pyCalls, pyCandlesByCallId, params, config);

      // Compare results
      expect(pyResult.tradesExecuted).toBe(tsResult.tradesExecuted);
      expect(pyResult.completedTrades.length).toBe(tsResult.completedTrades.length);

      if (tsResult.completedTrades.length > 0 && pyResult.completedTrades.length > 0) {
        const tsTrade = tsResult.completedTrades[0];
        const pyTrade = pyResult.completedTrades[0];

        expect(pyTrade.exitReason).toBe(tsTrade.exitReason);
        expect(pyTrade.exitReason).toBe('stop_loss');
        expect(pyTrade.exitPx).toBeCloseTo(tsTrade.exitPx, 2);
        expect(pyTrade.pnl).toBeCloseTo(tsTrade.pnl, 1);
      }

      expect(pyResult.finalCapital).toBeCloseTo(tsResult.finalCapital, 1);
    });
  });

  describe('Time exit scenario', () => {
    it('should produce identical results for time exit', async () => {
      const call = makeCall('call_time', 'TOKEN_TIME', 'CallerTime', baseTs);

      // Create candles: price stays flat, no TP/SL hit
      const candles: Candle[] = [];
      for (let i = 0; i < 100; i++) {
        // More than 48 hours worth (48 * 60 = 2880 minutes)
        const ts = baseTs + i * 60000;
        const price = 1.0 + (i % 10) * 0.01; // Slight oscillation
        candles.push(makeCandle(ts, price * 0.99, price * 1.01, price * 0.98, price));
      }

      const params: V1BaselineParams = {
        tp_mult: 2.0,
        sl_mult: 0.85,
        max_hold_hrs: 48,
      };

      const config: CapitalSimulatorConfig = {
        initialCapital: 10_000,
      };

      // Run TypeScript simulation
      const tsCandlesByCallId = new Map<string, Candle[]>();
      tsCandlesByCallId.set(call.id, candles);
      const tsResult = simulateCapitalAware([call], tsCandlesByCallId, params, config);

      // Run Python simulation
      const pyCalls = [
        { id: call.id, mint: call.mint, caller: call.caller, ts_ms: call.createdAt.toMillis() },
      ];
      const pyCandlesByCallId: Record<string, Candle[]> = {};
      pyCandlesByCallId[call.id] = candles;
      const pyResult = await runPythonSimulator(pyCalls, pyCandlesByCallId, params, config);

      // Compare results
      expect(pyResult.tradesExecuted).toBe(tsResult.tradesExecuted);
      expect(pyResult.completedTrades.length).toBe(tsResult.completedTrades.length);

      if (tsResult.completedTrades.length > 0 && pyResult.completedTrades.length > 0) {
        const tsTrade = tsResult.completedTrades[0];
        const pyTrade = pyResult.completedTrades[0];

        expect(pyTrade.exitReason).toBe(tsTrade.exitReason);
        expect(pyTrade.exitReason).toBe('time_exit');
        // Exit timestamp should be close (within 1 minute tolerance)
        expect(Math.abs(pyTrade.exitTsMs - tsTrade.exitTsMs)).toBeLessThan(60000);
      }

      expect(pyResult.finalCapital).toBeCloseTo(tsResult.finalCapital, 1);
    });
  });
});
