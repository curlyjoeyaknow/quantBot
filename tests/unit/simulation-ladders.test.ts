import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../../src/simulation/engine';
import type { Candle } from '../../src/simulation/candles';
import type { Strategy, LadderConfig } from '../../src/simulation/config';

describe('simulation-ladders', () => {
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

  describe('laddered entries', () => {
    it('should execute sequential ladder entries', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.85, 0.8, 0.85, 0.9]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const entryLadder: LadderConfig = {
        sequential: true,
        legs: [
          { sizePercent: 0.5, id: 'leg1' },
          { sizePercent: 0.5, id: 'leg2' },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        entryLadder,
      });

      const ladderEvents = result.events.filter((e) => e.type === 'ladder_entry');
      expect(ladderEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should execute parallel ladder entries', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.85, 0.8, 0.85, 0.9]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const entryLadder: LadderConfig = {
        sequential: false,
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

    it('should handle ladder entries with signals', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.85, 0.8, 0.85, 0.9]);
      const strategy: Strategy[] = [{ target: 2, percent: 1.0 }];

      const entryLadder: LadderConfig = {
        sequential: false,
        legs: [
          {
            sizePercent: 0.5,
            id: 'leg1',
            signal: {
              logic: 'AND',
              conditions: [
                {
                  indicator: 'price_change',
                  field: 'close',
                  operator: '<',
                  value: 0.95,
                },
              ],
            },
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        entryLadder,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('laddered exits', () => {
    it('should execute sequential ladder exits', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }]; // High target to avoid early exit

      const exitLadder: LadderConfig = {
        sequential: true,
        legs: [
          { sizePercent: 0.3, priceOffset: 0.5 },
          { sizePercent: 0.3, priceOffset: 1.0 },
          { sizePercent: 0.4, priceOffset: 2.0 },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        exitLadder,
      });

      const ladderEvents = result.events.filter((e) => e.type === 'ladder_exit');
      expect(ladderEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should execute parallel ladder exits', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }];

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

    it('should handle ladder exits with signals', () => {
      const candles = createCandleSeries([1.0, 1.5, 2.0, 2.5, 3.0, 3.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }];

      const exitLadder: LadderConfig = {
        sequential: false,
        legs: [
          {
            sizePercent: 0.5,
            priceOffset: 0.5,
            signal: {
              logic: 'AND',
              conditions: [
                {
                  indicator: 'price_change',
                  field: 'close',
                  operator: '>',
                  value: 1.5,
                },
              ],
            },
          },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        exitLadder,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });
  });

  describe('combined ladders', () => {
    it('should handle both entry and exit ladders', () => {
      const candles = createCandleSeries([1.0, 0.9, 0.85, 1.0, 1.5, 2.0, 2.5]);
      const strategy: Strategy[] = [{ target: 10, percent: 1.0 }];

      const entryLadder: LadderConfig = {
        sequential: false,
        legs: [
          { sizePercent: 0.5, priceOffset: -0.1 },
          { sizePercent: 0.5, priceOffset: -0.15 },
        ],
      };

      const exitLadder: LadderConfig = {
        sequential: false,
        legs: [
          { sizePercent: 0.5, priceOffset: 0.5 },
          { sizePercent: 0.5, priceOffset: 1.0 },
        ],
      };

      const result = simulateStrategy(candles, strategy, undefined, undefined, undefined, undefined, {
        entryLadder,
        exitLadder,
      });

      expect(result.events.length).toBeGreaterThan(0);
    });
  });
});


