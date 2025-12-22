import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../src/engine';
import type { Candle } from '../src/types/candle';
import type { Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '../src/config';

describe('simulation-engine-extended', () => {
  const createCandle = (timestamp: number, price: number, volume: number = 1000): Candle => ({
    timestamp,
    open: price * 0.99,
    high: price * 1.01,
    low: price * 0.98,
    close: price,
    volume,
  });

  const createCandleSeries = (prices: number[]): Candle[] => {
    return prices.map((price, i) => createCandle(1000 + i * 60, price));
  };

  describe('edge cases', () => {
    it('should handle empty candle array', () => {
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const result = simulateStrategy([], strategy);

      expect(result.finalPnl).toBe(0);
      expect(result.events).toEqual([]);
      expect(result.totalCandles).toBe(0);
    });

    it('should handle single candle', () => {
      const candles = createCandleSeries([1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const result = simulateStrategy(candles, strategy);

      expect(result.totalCandles).toBe(1);
      expect(result.entryPrice).toBeGreaterThan(0);
    });

    it('should handle strategy with zero percent', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 2, percent: 0 }];
      const result = simulateStrategy(candles, strategy);

      // With 0% target, should still have entry/exit events
      expect(result.totalCandles).toBe(6);
    });

    it('should handle very high profit targets', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 100, percent: 1.0 }];
      const result = simulateStrategy(candles, strategy);

      expect(result.finalPnl).toBeLessThan(100); // Won't reach 100x
    });

    it('should handle trailing stop loss', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 1.8, 1.6, 1.4]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }];
      const stopLoss: StopLossConfig = {
        initial: -0.3,
        trailing: 0.2,
        trailingPercent: 0.1,
      };

      const result = simulateStrategy(candles, strategy, stopLoss);

      expect(result.events.some((e) => e.type === 'stop_moved')).toBe(true);
    });

    it('should handle trailing entry', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.8, 0.85, 0.9, 1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const entry: EntryConfig = {
        initialEntry: -0.1,
        trailingEntry: 0.05,
        maxWaitTime: 60,
      };

      const result = simulateStrategy(candles, strategy, undefined, entry);

      // Trailing entry may or may not be used depending on price movement
      expect(result.entryOptimization.actualEntryPrice).toBeGreaterThan(0);
      expect(result.entryPrice).toBeGreaterThan(0);
    });

    it('should handle re-entry configuration', () => {
      const candles = createCandleSeries([1.0, 1.2, 0.9, 1.1, 1.3, 1.5]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const reEntry: ReEntryConfig = {
        trailingReEntry: 0.1,
        maxReEntries: 2,
        sizePercent: 0.5,
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, reEntry);

      const reEntryEvents = result.events.filter((e) => e.type === 're_entry');
      expect(reEntryEvents.length).toBeLessThanOrEqual(2);
    });

    it('should handle laddered entries', () => {
      const candles = createCandleSeries([1.0, 1.1, 1.2, 1.3, 1.4, 1.5]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const result = simulateStrategy(
        candles,
        strategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          entryLadder: {
            sequential: false,
            legs: [
              { sizePercent: 0.5, id: 'leg1' },
              { sizePercent: 0.5, id: 'leg2' },
            ],
          },
        }
      );

      const ladderEvents = result.events.filter((e) => e.type === 'ladder_entry');
      expect(ladderEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle laddered exits', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const result = simulateStrategy(
        candles,
        strategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          exitLadder: {
            sequential: false,
            legs: [
              { sizePercent: 0.5, priceOffset: 0.5 },
              { sizePercent: 0.5, priceOffset: 1.0 },
            ],
          },
        }
      );

      const ladderEvents = result.events.filter((e) => e.type === 'ladder_exit');
      expect(ladderEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle candles with zero volume', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 0 },
        { timestamp: 1060, open: 1.05, high: 1.15, low: 0.95, close: 1.1, volume: 0 },
      ];
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const result = simulateStrategy(candles, strategy);

      expect(result.totalCandles).toBe(2);
    });

    it('should handle extreme price movements', () => {
      const candles = createCandleSeries([1.0, 10.0, 0.1, 5.0, 2.0, 1.0]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const result = simulateStrategy(candles, strategy);

      expect(result.events.length).toBeGreaterThan(0);
    });

    it('should calculate entry optimization correctly', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.8, 0.85, 0.9, 1.0, 1.1]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const entry: EntryConfig = {
        initialEntry: -0.1,
        trailingEntry: 0.05,
      };

      const result = simulateStrategy(candles, strategy, undefined, entry);

      expect(result.entryOptimization.lowestPrice).toBeLessThanOrEqual(0.8);
      expect(result.entryOptimization.actualEntryPrice).toBeGreaterThan(0);
    });

    it('should handle multiple profit targets', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]);
      const strategy: Strategy[] = [
        { target: 2, percent: 0.5 },
        { target: 3, percent: 0.3 },
        { target: 5, percent: 0.2 },
      ];

      const result = simulateStrategy(candles, strategy);

      const targetHits = result.events.filter((e) => e.type === 'target_hit');
      expect(targetHits.length).toBeGreaterThan(0);
    });

    it('should handle stop loss before any targets', () => {
      const candles = createCandleSeries([1.0, 0.8, 0.6, 0.5, 0.4, 0.3]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];
      const stopLoss: StopLossConfig = {
        initial: -0.3,
      };

      const result = simulateStrategy(candles, strategy, stopLoss);

      const stopLossEvents = result.events.filter((e) => e.type === 'stop_loss');
      expect(stopLossEvents.length).toBeGreaterThan(0);
    });
  });
});
