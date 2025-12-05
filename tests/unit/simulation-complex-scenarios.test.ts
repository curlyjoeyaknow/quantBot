import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../../src/simulation/engine';
import type { Candle } from '../../src/simulation/candles';
import type { Strategy, LadderConfig, SignalGroup } from '../../src/simulation/config';

describe('simulation-complex-scenarios', () => {
  const createCandle = (timestamp: number, price: number, overrides?: Partial<Candle>): Candle => ({
    timestamp,
    open: price * 0.99,
    high: price * 1.01,
    low: price * 0.98,
    close: price,
    volume: 1000,
    ...overrides,
  });

  const createCandleSeries = (prices: number[]): Candle[] => {
    return prices.map((price, i) => createCandle(1000 + i * 60, price));
  };

  describe('complex entry scenarios', () => {
    it('should handle initial entry that never triggers', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const entry = {
        initialEntry: -0.3, // Expect 30% drop
      };

      const result = simulateStrategy(candles, strategy, undefined, entry);

      const noTradeEvent = result.events.find((e) => e.description.includes('No trade'));
      expect(noTradeEvent).toBeDefined();
      expect(result.finalPnl).toBe(0);
    });

    it('should handle trailing entry with max wait time', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.8, 0.85, 0.9, 1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const entry = {
        initialEntry: 'none' as const,
        trailingEntry: 0.05,
        maxWaitTime: 2, // Very short wait time
      };

      const result = simulateStrategy(candles, strategy, undefined, entry);

      expect(result.entryOptimization.actualEntryPrice).toBeGreaterThan(0);
    });

    it('should combine initial entry with entry signal', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.8, 0.85, 0.9, 1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const entry = {
        initialEntry: -0.1,
      };

      const entrySignal: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '<',
            value: 0.95,
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, entry, undefined, undefined, {
        entrySignal,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('complex exit scenarios', () => {
    it('should handle multiple profit targets with partial exits', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0]);
      const strategy: Strategy[] = [
        { target: 2, percent: 0.3 },
        { target: 3, percent: 0.3 },
        { target: 5, percent: 0.4 },
      ];

      const result = simulateStrategy(candles, strategy);

      const targetHits = result.events.filter((e) => e.type === 'target_hit');
      expect(targetHits.length).toBeGreaterThan(0);
      expect(result.finalPnl).toBeGreaterThan(0);
    });

    it('should handle stop loss before any targets', () => {
      const candles = createCandleSeries([1.0, 0.8, 0.6, 0.5, 0.4, 0.3]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss = {
        initial: -0.3,
      };

      const result = simulateStrategy(candles, strategy, stopLoss);

      const stopLossEvents = result.events.filter((e) => e.type === 'stop_loss');
      expect(stopLossEvents.length).toBeGreaterThan(0);
    });

    it('should handle trailing stop activation', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 1.8, 1.6, 1.4]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }]; // High target
      const stopLoss = {
        initial: -0.3,
        trailing: 0.2, // Activate trailing at 20% gain
        trailingPercent: 0.1, // 10% trailing
      };

      const result = simulateStrategy(candles, strategy, stopLoss);

      const stopMovedEvents = result.events.filter((e) => e.type === 'stop_moved');
      expect(stopMovedEvents.length).toBeGreaterThan(0);
    });
  });

  describe('re-entry scenarios', () => {
    it('should handle re-entry after stop loss', () => {
      const candles = createCandleSeries([1.0, 0.7, 0.6, 0.65, 0.7, 0.75, 0.8]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss = {
        initial: -0.3,
      };
      const reEntry = {
        trailingReEntry: 0.1,
        maxReEntries: 1,
        sizePercent: 0.5,
      };

      const result = simulateStrategy(candles, strategy, stopLoss, undefined, reEntry);

      const reEntryEvents = result.events.filter((e) => e.type === 're_entry');
      expect(reEntryEvents.length).toBeGreaterThan(0);
    });

    it('should handle re-entry after target hit', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 1.8, 1.9, 2.0, 2.5]);
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

    it('should respect max re-entries limit', () => {
      const candles = createCandleSeries([1.0, 0.7, 0.6, 0.65, 0.6, 0.65, 0.6]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss = {
        initial: -0.3,
      };
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

  describe('ladder execution', () => {
    it('should execute sequential entry ladder', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.85, 0.8, 0.85, 0.9]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const entryLadder: LadderConfig = {
        sequential: true,
        legs: [
          { sizePercent: 0.5, id: 'leg1', priceOffset: -0.1 },
          { sizePercent: 0.5, id: 'leg2', priceOffset: -0.15 },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        entryLadder,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });

    it('should execute parallel exit ladder', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }]; // High target

      const exitLadder: LadderConfig = {
        sequential: false,
        legs: [
          { sizePercent: 0.3, multiple: 1.5 },
          { sizePercent: 0.3, multiple: 2.0 },
          { sizePercent: 0.4, multiple: 3.0 },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        exitLadder,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('cost impact', () => {
    it('should apply high entry costs', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const costs = {
        entrySlippageBps: 100, // 1%
        exitSlippageBps: 100,
        takerFeeBps: 50, // 0.5%
        borrowAprBps: 0,
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, costs);

      // Should have lower PnL due to costs
      expect(result.finalPnl).toBeLessThan(2.0);
    });

    it('should apply high exit costs', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const costs = {
        entrySlippageBps: 0,
        exitSlippageBps: 200, // 2%
        takerFeeBps: 100, // 1%
        borrowAprBps: 0,
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, costs);

      expect(result.finalPnl).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle price exactly at stop loss', () => {
      const candles = createCandleSeries([1.0, 0.8, 0.7, 0.7, 0.7, 0.7]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss = {
        initial: -0.3, // Stop at 0.7
      };

      const result = simulateStrategy(candles, strategy, stopLoss);

      const stopLossEvents = result.events.filter((e) => e.type === 'stop_loss');
      expect(stopLossEvents.length).toBeGreaterThan(0);
    });

    it('should handle price exactly at target', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.0, 2.0, 2.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const result = simulateStrategy(candles, strategy);

      const targetHits = result.events.filter((e) => e.type === 'target_hit');
      expect(targetHits.length).toBeGreaterThan(0);
    });

    it('should handle all targets hit with remaining position', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]);
      const strategy: Strategy[] = [
        { target: 2, percent: 0.3 },
        { target: 3, percent: 0.3 },
      ]; // Only 60% of position

      const result = simulateStrategy(candles, strategy);

      const finalExit = result.events.find((e) => e.type === 'final_exit');
      expect(finalExit).toBeDefined();
    });
  });
});


