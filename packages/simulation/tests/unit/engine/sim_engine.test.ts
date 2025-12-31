/**
 * Unit tests for pure simulator engine
 */

import { describe, it, expect } from 'vitest';
import { simulateToken, type StrategyConfig, type Candle } from '../../../src/engine/index.js';

describe('simulateToken', () => {
  const mockCandles: Candle[] = [
    { ts: '2024-01-01T00:00:00Z', o: 1.0, h: 1.1, l: 0.9, c: 1.0, v: 1000 },
    { ts: '2024-01-01T00:05:00Z', o: 1.0, h: 1.2, l: 0.95, c: 1.1, v: 1200 },
    { ts: '2024-01-01T00:10:00Z', o: 1.1, h: 1.3, l: 1.0, c: 1.2, v: 1500 },
    { ts: '2024-01-01T00:15:00Z', o: 1.2, h: 1.4, l: 1.1, c: 1.3, v: 1800 },
    { ts: '2024-01-01T00:20:00Z', o: 1.3, h: 1.5, l: 1.2, c: 1.4, v: 2000 },
  ];

  it('should return empty result for empty candles', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 5 },
      execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
    };

    const result = simulateToken('token1', [], strategy);

    expect(result.summary.trades).toBe(0);
    expect(result.summary.win_rate).toBe(0);
    expect(result.trades).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(result.frames).toHaveLength(0);
  });

  it('should simulate immediate entry with target exit', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
    };

    const result = simulateToken('token1', mockCandles, strategy);

    expect(result.summary.trades).toBeGreaterThan(0);
    expect(result.trades.length).toBe(result.summary.trades);
    expect(result.frames.length).toBe(mockCandles.length);
  });

  it('should generate events for entry and exit', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: { targets: [{ size_pct: 100, profit_pct: 5 }] },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', mockCandles, strategy);

    const entryEvents = result.events.filter((e) => e.type === 'ENTRY_FILLED');
    const exitEvents = result.events.filter((e) => e.type === 'EXIT_FULL');

    expect(entryEvents.length).toBeGreaterThan(0);
    expect(exitEvents.length).toBeGreaterThan(0);
  });

  it('should respect stop loss', () => {
    const strategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: { targets: [] },
      stops: { stop_loss_pct: 50 }, // 50% stop loss
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    // Create candles that will hit stop loss
    const downCandles: Candle[] = [
      { ts: '2024-01-01T00:00:00Z', o: 1.0, h: 1.0, l: 0.4, c: 0.5, v: 1000 },
      { ts: '2024-01-01T00:05:00Z', o: 0.5, h: 0.6, l: 0.4, c: 0.5, v: 1200 },
    ];

    const result = simulateToken('token1', downCandles, strategy);

    const stopEvents = result.events.filter((e) => e.type === 'STOP_HIT');
    expect(stopEvents.length).toBeGreaterThan(0);

    const stopTrade = result.trades.find((t) => t.exit_reason === 'stop');
    expect(stopTrade).toBeDefined();
  });

  it('should handle delay in entry', () => {
    const strategy: StrategyConfig = {
      entry: {
        mode: 'immediate',
        delay: { mode: 'candles', n: 2 },
      },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 0 },
      execution: { fill_model: 'close', fee_bps: 0, slippage_bps: 0 },
    };

    const result = simulateToken('token1', mockCandles, strategy);

    // Entry should be delayed by 2 candles
    const entryEvent = result.events.find((e) => e.type === 'ENTRY_FILLED');
    expect(entryEvent).toBeDefined();
    expect(entryEvent?.candle_index).toBeGreaterThanOrEqual(2);
  });
});
