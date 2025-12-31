/**
 * Golden tests for simulator engine
 *
 * These tests ensure the TypeScript simulator produces identical results
 * to the Python simulator for known inputs.
 */

import { describe, it, expect } from 'vitest';
import { simulateToken, type StrategyConfig, type Candle } from '../../src/engine/index.js';

describe('Simulator Engine Golden Tests', () => {
  // Golden test fixture: known inputs and expected outputs
  const goldenCandles: Candle[] = [
    { ts: '2024-01-01T00:00:00Z', o: 1.0, h: 1.05, l: 0.95, c: 1.0, v: 1000 },
    { ts: '2024-01-01T00:05:00Z', o: 1.0, h: 1.1, l: 0.98, c: 1.05, v: 1200 },
    { ts: '2024-01-01T00:10:00Z', o: 1.05, h: 1.15, l: 1.0, c: 1.1, v: 1500 },
    { ts: '2024-01-01T00:15:00Z', o: 1.1, h: 1.2, l: 1.05, c: 1.15, v: 1800 },
    { ts: '2024-01-01T00:20:00Z', o: 1.15, h: 1.25, l: 1.1, c: 1.2, v: 2000 },
    { ts: '2024-01-01T00:25:00Z', o: 1.2, h: 1.3, l: 1.15, c: 1.25, v: 2200 },
  ];

  it('GOLDEN: immediate entry with single target exit', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', goldenCandles, strategy);

    // Should enter immediately and exit when target is hit
    expect(result.summary.trades).toBe(1);
    expect(result.trades[0]?.exit_reason).toBe('targets_done');
    expect(result.trades[0]?.pnl_pct).toBeGreaterThan(0);

    // Should have entry and exit events
    const entryEvents = result.events.filter((e) => e.type === 'ENTRY_FILLED');
    const exitEvents = result.events.filter((e) => e.type === 'EXIT_FULL');
    expect(entryEvents.length).toBe(1);
    expect(exitEvents.length).toBe(1);

    // Should have frames for all candles
    expect(result.frames.length).toBe(goldenCandles.length);
  });

  it('GOLDEN: RSI below entry signal', () => {
    // Create candles with declining prices (RSI should go below 30)
    const decliningCandles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
      ts: `2024-01-01T00:${String(i * 5).padStart(2, '0')}:00Z`,
      o: 1.0 - i * 0.02,
      h: 1.0 - i * 0.02 + 0.01,
      l: 1.0 - i * 0.02 - 0.01,
      c: 1.0 - i * 0.02,
      v: 1000,
    }));

    const strategy: StrategyConfig = {
      entry: {
        mode: 'signal',
        signal: { type: 'rsi_below', period: 14, value: 30 },
      },
      exits: { targets: [{ size_pct: 100, profit_pct: 5 }] },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', decliningCandles, strategy);

    // Should have entry signal event
    const signalEvents = result.events.filter((e) => e.type === 'ENTRY_SIGNAL_TRUE');
    expect(signalEvents.length).toBeGreaterThan(0);
  });

  it('GOLDEN: stop loss triggered', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: { targets: [] },
      stops: { stop_loss_pct: 10 }, // 10% stop loss
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    // Create candles that will hit stop loss
    const downCandles: Candle[] = [
      { ts: '2024-01-01T00:00:00Z', o: 1.0, h: 1.0, l: 0.85, c: 0.9, v: 1000 },
      { ts: '2024-01-01T00:05:00Z', o: 0.9, h: 0.95, l: 0.85, c: 0.9, v: 1200 },
    ];

    const result = simulateToken('token1', downCandles, strategy);

    expect(result.summary.trades).toBe(1);
    expect(result.trades[0]?.exit_reason).toBe('stop');
    expect(result.trades[0]?.pnl_pct).toBeLessThan(0);

    const stopEvents = result.events.filter((e) => e.type === 'STOP_HIT');
    expect(stopEvents.length).toBe(1);
  });

  it('GOLDEN: ladder targets with partial exits', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: {
        targets: [
          { size_pct: 50, profit_pct: 5 },
          { size_pct: 50, profit_pct: 10 },
        ],
      },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', goldenCandles, strategy);

    // Should have partial exit events
    const partialExits = result.events.filter((e) => e.type === 'PARTIAL_EXIT');
    expect(partialExits.length).toBeGreaterThan(0);

    // Should have target hit events
    const targetHits = result.events.filter((e) => e.type === 'TARGET_HIT');
    expect(targetHits.length).toBe(2);
  });

  it('GOLDEN: trailing stop activation', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: {
        targets: [],
        trailing: {
          enabled: true,
          trail_pct: 5,
          activate_profit_pct: 10,
        },
      },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', goldenCandles, strategy);

    // Should have trailing stop activation
    const stopMovedEvents = result.events.filter((e) => e.type === 'STOP_MOVED');
    expect(stopMovedEvents.length).toBeGreaterThan(0);

    const trailingActivated = stopMovedEvents.some((e) => e.data.reason === 'trailing_activated');
    expect(trailingActivated).toBe(true);
  });

  it('GOLDEN: time exit', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: {
        targets: [],
        time_exit: { enabled: true, max_candles_in_trade: 3 },
      },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', goldenCandles, strategy);

    expect(result.summary.trades).toBe(1);
    expect(result.trades[0]?.exit_reason).toBe('time_exit');

    const timeExitEvents = result.events.filter((e) => {
      return e.type === 'EXIT_FULL' && e.data.reason === 'time_exit';
    });
    expect(timeExitEvents.length).toBe(1);
  });

  it('GOLDEN: break-even after first target', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: {
        targets: [
          { size_pct: 50, profit_pct: 5 },
          { size_pct: 50, profit_pct: 10 },
        ],
      },
      stops: {
        stop_loss_pct: 10,
        break_even_after_first_target: true,
      },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', goldenCandles, strategy);

    // Should have break-even stop move
    const breakEvenMoves = result.events.filter((e) => {
      return e.type === 'STOP_MOVED' && e.data.reason === 'break_even_after_first_target';
    });
    expect(breakEvenMoves.length).toBeGreaterThan(0);
  });

  it('GOLDEN: stop then target same candle (conservative_long ordering)', () => {
    // Python golden test: stop and target both possible in same candle
    // With conservative_long intrabar ordering: STOP (via L) happens before TARGET (via H)
    const candles: Candle[] = [
      { ts: '2025-01-01T00:00:00Z', o: 100, h: 101, l: 99, c: 100, v: 1 },
      { ts: '2025-01-01T00:01:00Z', o: 100, h: 120, l: 80, c: 110, v: 1 }, // target and stop both possible
    ];

    const strategy: StrategyConfig = {
      entry: { mode: 'immediate', delay: { mode: 'none' } },
      exits: {
        targets: [{ size_pct: 100, profit_pct: 10 }],
        trailing: { enabled: false },
        time_exit: { enabled: false },
      },
      stops: { stop_loss_pct: 10, break_even_after_first_target: false },
      execution: { fill_model: 'open', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('TKN', candles, strategy);

    expect(result.trades.length).toBe(1);
    expect(result.trades[0]?.exit_reason).toBe('stop');
    // stop price = entry*(1-0.10) = 90
    expect(Math.abs(result.trades[0]!.exit_price - 90.0)).toBeLessThan(1e-9);
  });
});
