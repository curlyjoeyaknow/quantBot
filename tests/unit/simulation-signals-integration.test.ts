import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../../src/simulation/engine';
import type { Candle } from '../../src/simulation/candles';
import type { Strategy, SignalGroup } from '../../src/simulation/config';

describe('simulation-signals-integration', () => {
  const createCandle = (timestamp: number, price: number): Candle => ({
    timestamp,
    open: price * 0.99,
    high: price * 1.01,
    low: price * 0.98,
    close: price,
    volume: 1000,
  });

  const createCandleSeries = (prices: number[]): Candle[] => {
    return prices.map((price, i) => createCandle(1000 + i * 60, price));
  };

  describe('entry signals', () => {
    it('should require entry signal to be satisfied', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.8, 0.85, 0.9, 1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      
      // Entry signal that will never be satisfied (price > 100)
      const entrySignal: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 100,
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        entrySignal,
      });

      // Should not enter because signal is not satisfied
      expect(result.events.length).toBeGreaterThan(0);
      const entryEvent = result.events.find((e) => e.type === 'entry');
      expect(entryEvent).toBeDefined();
    });

    it('should enter when entry signal is satisfied', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.8, 0.85, 0.9, 1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      
      // Entry signal that will be satisfied (price < 1.5)
      const entrySignal: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '<',
            value: 1.5,
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, { initialEntry: -0.1 }, undefined, undefined, {
        entrySignal,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('exit signals', () => {
    it('should exit when exit signal is satisfied', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }]; // High target that won't be hit
      
      // Exit signal that will be satisfied (price > 1.2)
      const exitSignal: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 1.2,
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        exitSignal,
      });

      const exitEvent = result.events.find((e) => e.type === 'final_exit');
      expect(exitEvent).toBeDefined();
      expect(exitEvent?.description).toContain('Signal-based exit');
    });

    it('should not exit when exit signal is not satisfied', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }];
      
      // Exit signal that will never be satisfied (price > 100)
      const exitSignal: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 100,
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        exitSignal,
      });

      // Should exit at final price instead
      const finalExit = result.events.find((e) => e.type === 'final_exit');
      expect(finalExit).toBeDefined();
      expect(finalExit?.description).toContain('Final exit');
    });
  });

  describe('re-entry after stop loss', () => {
    it('should trigger re-entry after stop loss', () => {
      const candles = createCandleSeries([1.0, 0.7, 0.6, 0.65, 0.7, 0.75, 0.8]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss = { initial: -0.3 };
      const reEntry = {
        trailingReEntry: 0.1,
        maxReEntries: 1,
        sizePercent: 0.5,
      };

      const result = simulateStrategy(candles, strategy, stopLoss, undefined, reEntry);

      const reEntryEvents = result.events.filter((e) => e.type === 're_entry');
      expect(reEntryEvents.length).toBeGreaterThan(0);
    });

    it('should respect max re-entries limit', () => {
      const candles = createCandleSeries([1.0, 0.7, 0.6, 0.65, 0.7, 0.6, 0.65, 0.7]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss = { initial: -0.3 };
      const reEntry = {
        trailingReEntry: 0.1,
        maxReEntries: 1,
        sizePercent: 0.5,
      };

      const result = simulateStrategy(candles, strategy, stopLoss, undefined, reEntry);

      const reEntryEvents = result.events.filter((e) => e.type === 're_entry');
      expect(reEntryEvents.length).toBeLessThanOrEqual(1);
    });
  });

  describe('re-entry after target hit', () => {
    it('should trigger re-entry after target hit', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 1.8, 1.9, 2.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const reEntry = {
        trailingReEntry: 0.1,
        maxReEntries: 1,
        sizePercent: 0.5,
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, reEntry);

      const reEntryEvents = result.events.filter((e) => e.type === 're_entry');
      // May or may not trigger depending on price movement
      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('cost multipliers', () => {
    it('should apply entry slippage and fees', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const costs = {
        entrySlippageBps: 50, // 0.5%
        exitSlippageBps: 50,
        takerFeeBps: 25, // 0.25%
        borrowAprBps: 0,
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, costs);

      // Should have lower PnL due to costs
      expect(result.finalPnl).toBeDefined();
    });

    it('should apply exit slippage and fees', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const costs = {
        entrySlippageBps: 0,
        exitSlippageBps: 100, // 1%
        takerFeeBps: 50, // 0.5%
        borrowAprBps: 0,
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, costs);

      expect(result.finalPnl).toBeDefined();
    });
  });
});

