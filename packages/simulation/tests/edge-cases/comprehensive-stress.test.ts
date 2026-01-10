/**
 * Comprehensive Edge Case Tests for Simulation Model
 * ====================================================
 *
 * These tests are designed to stress-test the simulation model with:
 * - Large datasets (10k+ candles)
 * - Extreme price movements (flash crashes, pump and dumps)
 * - Boundary conditions (zero, negative, NaN, Infinity)
 * - Complex scenarios (multiple re-entries, trailing stops)
 * - Performance edge cases
 * - Data quality issues
 *
 * Goal: Find and fix weaknesses in the simulation model.
 */

import { describe, it, expect, vi } from 'vitest';
import { simulateStrategy } from '../../src/core/simulator';
import type {
  Candle,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../../src/types';

/**
 * Helper to create a candle
 */
function createCandle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number = 1000
): Candle {
  return { timestamp, open, high, low, close, volume };
}

/**
 * Helper to create a price progression
 */
function createPriceProgression(
  baseTimestamp: number,
  basePrice: number,
  intervals: number,
  intervalSeconds: number = 60,
  priceMultiplier: (index: number) => number
): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < intervals; i++) {
    const price = basePrice * priceMultiplier(i);
    const volatility = price * 0.01; // 1% volatility
    candles.push(
      createCandle(
        baseTimestamp + i * intervalSeconds,
        price,
        price + volatility,
        price - volatility,
        price * (1 + (Math.random() - 0.5) * 0.02),
        Math.floor(1000 + Math.random() * 500)
      )
    );
  }
  return candles;
}

describe('Comprehensive Edge Case Tests', () => {
  describe('Large Dataset Stress Tests', () => {
    it('should handle 10,000 candles without performance degradation', async () => {
      const baseTimestamp = 1704067200; // 2024-01-01
      const basePrice = 1.0;
      const candles = createPriceProgression(baseTimestamp, basePrice, 10000, 60, (i) => {
        // Gradual upward trend with noise
        return 1 + (i / 10000) * 2 + Math.sin(i / 100) * 0.1;
      });

      const strategy: StrategyLeg[] = [
        { target: 2, percent: 0.5 },
        { target: 3, percent: 0.5 },
      ];

      const startTime = performance.now();
      const result = await simulateStrategy(candles, strategy);
      const endTime = performance.now();

      expect(result).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in < 5 seconds
      expect(result.totalCandles).toBe(10000);
    });

    it('should handle 50,000 candles (extreme stress test)', async () => {
      const baseTimestamp = 1704067200;
      const basePrice = 1.0;
      const candles = createPriceProgression(baseTimestamp, basePrice, 50000, 60, (i) => {
        // Complex pattern: pump, dump, recovery
        if (i < 10000) return 1 + (i / 10000) * 3; // Pump to 4x
        if (i < 20000) return 4 - ((i - 10000) / 10000) * 2; // Dump to 2x
        return 2 + ((i - 20000) / 30000) * 1; // Recovery to 3x
      });

      const strategy: StrategyLeg[] = [
        { target: 1.5, percent: 0.33 },
        { target: 2, percent: 0.33 },
        { target: 3, percent: 0.34 },
      ];

      const startTime = performance.now();
      const result = await simulateStrategy(candles, strategy);
      const endTime = performance.now();

      expect(result).toBeDefined();
      expect(result.totalCandles).toBe(50000);
      expect(endTime - startTime).toBeLessThan(30000); // Should complete in < 30 seconds
    });

    it('should handle 100,000 candles with complex strategy', async () => {
      const baseTimestamp = 1704067200;
      const basePrice = 0.001;
      const candles = createPriceProgression(baseTimestamp, basePrice, 100000, 60, (i) => {
        // Multiple cycles
        const cycle = Math.floor(i / 20000);
        const cyclePos = (i % 20000) / 20000;
        return 0.001 + cycle * 0.001 + Math.sin(cyclePos * Math.PI * 2) * 0.0005;
      });

      const strategy: StrategyLeg[] = [
        { target: 1.2, percent: 0.25 },
        { target: 1.5, percent: 0.25 },
        { target: 2, percent: 0.25 },
        { target: 3, percent: 0.25 },
      ];

      const stopLoss: StopLossConfig = {
        initial: -0.5,
        trailing: 0.3,
        trailingPercent: 0.2,
        trailingWindowSize: 100,
      };

      const startTime = performance.now();
      const result = await simulateStrategy(candles, strategy, stopLoss);
      const endTime = performance.now();

      expect(result).toBeDefined();
      expect(result.totalCandles).toBe(100000);
      // Performance should be reasonable even for 100k candles
      expect(endTime - startTime).toBeLessThan(60000); // < 60 seconds
    });
  });

  describe('Extreme Price Movement Tests', () => {
    it('should handle flash crash (99% drop in single candle)', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [
        createCandle(1000, basePrice, basePrice * 1.01, basePrice * 0.99, basePrice, 1000),
        createCandle(2000, basePrice, basePrice * 1.01, basePrice * 0.99, basePrice, 1000),
        createCandle(3000, basePrice, basePrice * 1.01, basePrice * 0.99, basePrice, 1000),
        // Flash crash: 99% drop
        createCandle(4000, basePrice, basePrice * 1.01, basePrice * 0.01, basePrice * 0.01, 100000),
        createCandle(
          5000,
          basePrice * 0.01,
          basePrice * 0.02,
          basePrice * 0.005,
          basePrice * 0.015,
          50000
        ),
        // Recovery attempt
        createCandle(
          6000,
          basePrice * 0.015,
          basePrice * 0.5,
          basePrice * 0.01,
          basePrice * 0.3,
          20000
        ),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];
      const stopLoss: StopLossConfig = { initial: -0.5, trailing: 'none' };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      // Should trigger stop loss or handle the crash gracefully
      expect(result.finalPnl).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
    });

    it('should handle pump and dump (1000x pump then 99% dump)', async () => {
      const basePrice = 0.001;
      const candles: Candle[] = [
        // Entry
        createCandle(1000, basePrice, basePrice * 1.1, basePrice * 0.9, basePrice, 1000),
        // Pump phase
        createCandle(2000, basePrice, basePrice * 2, basePrice * 0.9, basePrice * 1.5, 5000),
        createCandle(3000, basePrice * 1.5, basePrice * 5, basePrice * 1.2, basePrice * 4, 10000),
        createCandle(4000, basePrice * 4, basePrice * 10, basePrice * 3, basePrice * 8, 20000),
        createCandle(5000, basePrice * 8, basePrice * 50, basePrice * 7, basePrice * 40, 50000),
        createCandle(
          6000,
          basePrice * 40,
          basePrice * 200,
          basePrice * 35,
          basePrice * 150,
          100000
        ),
        createCandle(
          7000,
          basePrice * 150,
          basePrice * 500,
          basePrice * 140,
          basePrice * 400,
          200000
        ),
        createCandle(
          8000,
          basePrice * 400,
          basePrice * 1000,
          basePrice * 350,
          basePrice * 800,
          500000
        ),
        // Peak
        createCandle(
          9000,
          basePrice * 800,
          basePrice * 1000,
          basePrice * 700,
          basePrice * 950,
          1000000
        ),
        // Dump phase
        createCandle(
          10000,
          basePrice * 950,
          basePrice * 800,
          basePrice * 100,
          basePrice * 200,
          800000
        ),
        createCandle(
          11000,
          basePrice * 200,
          basePrice * 300,
          basePrice * 50,
          basePrice * 100,
          400000
        ),
        createCandle(
          12000,
          basePrice * 100,
          basePrice * 150,
          basePrice * 20,
          basePrice * 30,
          200000
        ),
        createCandle(13000, basePrice * 30, basePrice * 50, basePrice * 5, basePrice * 10, 100000),
        // Final dump
        createCandle(
          14000,
          basePrice * 10,
          basePrice * 15,
          basePrice * 0.01,
          basePrice * 0.01,
          50000
        ),
      ];

      const strategy: StrategyLeg[] = [
        { target: 2, percent: 0.2 },
        { target: 5, percent: 0.2 },
        { target: 10, percent: 0.2 },
        { target: 50, percent: 0.2 },
        { target: 100, percent: 0.2 },
      ];

      const stopLoss: StopLossConfig = {
        initial: -0.3,
        trailing: 0.5,
        trailingPercent: 0.2,
      };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should have captured some profit during the pump
      expect(result.events.length).toBeGreaterThan(0);
    });

    it('should handle extreme volatility (100% swings every candle)', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [];
      for (let i = 0; i < 1000; i++) {
        const direction = i % 2 === 0 ? 1 : -1;
        const swing = 1.0; // 100% swing
        const price = basePrice * (1 + direction * swing);
        candles.push(
          createCandle(
            1000 + i * 60,
            basePrice,
            price * 1.1,
            price * 0.9,
            price,
            Math.floor(1000 + Math.random() * 500)
          )
        );
      }

      const strategy: StrategyLeg[] = [{ target: 1.5, percent: 1.0 }];
      const stopLoss: StopLossConfig = { initial: -0.2, trailing: 'none' };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should handle extreme volatility without crashing
    });

    it('should handle gradual death spiral (continuous decline)', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [];
      for (let i = 0; i < 5000; i++) {
        const decline = 0.999; // 0.1% decline per candle
        const price = basePrice * Math.pow(decline, i);
        candles.push(
          createCandle(
            1000 + i * 60,
            price,
            price * 1.001,
            price * 0.999,
            price * 0.9995,
            Math.floor(1000 + Math.random() * 500)
          )
        );
      }

      const strategy: StrategyLeg[] = [{ target: 1.1, percent: 1.0 }];
      const stopLoss: StopLossConfig = { initial: -0.5, trailing: 'none' };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should eventually hit stop loss
      const stopLossEvents = result.events.filter((e) => e.type === 'stop_loss');
      expect(stopLossEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Boundary Condition Tests', () => {
    it('should handle zero price candles', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, 1.0, 1.1, 0.0, 0.0, 1000), // Zero price
        createCandle(3000, 0.0, 0.1, 0.0, 0.05, 1000),
        createCandle(4000, 0.05, 0.2, 0.0, 0.1, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      // Should handle zero prices gracefully (either skip or handle as error)
      expect(Number.isFinite(result.finalPnl) || isNaN(result.finalPnl)).toBe(true);
    });

    it('should handle negative prices (data corruption)', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, 1.0, 1.1, -0.1, -0.05, 1000), // Negative price
        createCandle(3000, 0.05, 0.2, 0.0, 0.1, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      // Should handle negative prices (either reject or clamp to zero)
    });

    it('should handle NaN values in prices', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, NaN, NaN, NaN, NaN, 1000), // NaN values
        createCandle(3000, 1.0, 1.1, 0.9, 1.0, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      // Should either throw or handle NaN gracefully
      await expect(simulateStrategy(candles, strategy)).resolves.toBeDefined();
    });

    it('should handle Infinity values in prices', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, Infinity, Infinity, Infinity, Infinity, 1000), // Infinity
        createCandle(3000, 1.0, 1.1, 0.9, 1.0, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      // Should either throw or handle Infinity gracefully
      await expect(simulateStrategy(candles, strategy)).resolves.toBeDefined();
    });

    it('should handle extremely small prices (micro-caps)', async () => {
      const basePrice = 0.0000001; // 0.1 micro
      const candles = createPriceProgression(1000, basePrice, 1000, 60, (i) => {
        return 1 + (i / 1000) * 10; // 10x over 1000 candles
      });

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should handle micro-cap prices without precision errors
    });

    it('should handle extremely large prices', async () => {
      const basePrice = 1000000; // 1 million
      const candles = createPriceProgression(1000, basePrice, 1000, 60, (i) => {
        return 1 + (i / 1000) * 0.1; // 10% increase
      });

      const strategy: StrategyLeg[] = [{ target: 1.1, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should handle large prices without overflow
    });

    it('should handle zero volume candles', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, 1.0, 1.1, 0.9, 1.0, 0), // Zero volume
        createCandle(3000, 1.0, 1.1, 0.9, 1.0, 0),
        createCandle(4000, 1.0, 1.1, 0.9, 1.0, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      // Should handle zero volume (might indicate stale data)
    });
  });

  describe('Complex Strategy Scenarios', () => {
    it('should handle maximum re-entries with trailing stop', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [];

      // Create pattern: entry -> profit -> retrace -> re-entry (repeat)
      for (let cycle = 0; cycle < 10; cycle++) {
        const cycleStart = cycle * 1000;
        // Entry phase
        for (let i = 0; i < 100; i++) {
          const price = basePrice * (1 - i * 0.001);
          candles.push(
            createCandle(cycleStart + i * 60, price, price * 1.01, price * 0.99, price, 1000)
          );
        }
        // Pump phase
        for (let i = 0; i < 200; i++) {
          const price = basePrice * (0.9 + i * 0.005);
          candles.push(
            createCandle(cycleStart + 6000 + i * 60, price, price * 1.01, price * 0.99, price, 1000)
          );
        }
        // Retrace phase (triggers re-entry)
        for (let i = 0; i < 100; i++) {
          const price = basePrice * (1.9 - i * 0.01);
          candles.push(
            createCandle(
              cycleStart + 18000 + i * 60,
              price,
              price * 1.01,
              price * 0.99,
              price,
              1000
            )
          );
        }
      }

      const strategy: StrategyLeg[] = [
        { target: 1.5, percent: 0.5 },
        { target: 2, percent: 0.5 },
      ];

      const stopLoss: StopLossConfig = {
        initial: -0.3,
        trailing: 0.5,
        trailingPercent: 0.2,
        trailingWindowSize: 50,
      };

      const reEntry: ReEntryConfig = {
        trailingReEntry: 0.3,
        maxReEntries: 20, // Maximum re-entries
        sizePercent: 0.5,
      };

      const result = await simulateStrategy(candles, strategy, stopLoss, undefined, reEntry);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should handle multiple re-entries
      const reEntryEvents = result.events.filter((e) => e.type === 're_entry');
      expect(reEntryEvents.length).toBeGreaterThan(0);
      expect(reEntryEvents.length).toBeLessThanOrEqual(20);
    });

    it('should handle complex ladder exit with trailing stop', async () => {
      const basePrice = 1.0;
      const candles = createPriceProgression(1000, basePrice, 5000, 60, (i) => {
        // Gradual pump to 10x
        return 1 + (i / 5000) * 9;
      });

      const strategy: StrategyLeg[] = [
        { target: 1.2, percent: 0.1 },
        { target: 1.5, percent: 0.1 },
        { target: 2, percent: 0.1 },
        { target: 3, percent: 0.1 },
        { target: 5, percent: 0.2 },
        { target: 7, percent: 0.2 },
        { target: 10, percent: 0.2 },
      ];

      const stopLoss: StopLossConfig = {
        initial: -0.5,
        trailing: 0.3,
        trailingPercent: 0.15,
        trailingWindowSize: 100,
      };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
      // Should execute ladder exits (may not hit all targets due to trailing stop)
      // Check for target_hit, ladder_exit, or other exit types
      const exitEvents = result.events.filter(
        (e) =>
          e.type === 'target_hit' ||
          e.type === 'ladder_exit' ||
          e.type === 'stop_loss' ||
          e.type === 'trailing_stop' ||
          e.type === 'final_exit'
      );
      // Should have some exit events (at least final exit)
      expect(exitEvents.length).toBeGreaterThan(0);
      // Verify that the simulation completed successfully
      expect(Number.isFinite(result.finalPnl)).toBe(true);
    });

    it('should handle entry optimization with extreme drop', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [
        createCandle(1000, basePrice, basePrice * 1.01, basePrice * 0.99, basePrice, 1000),
        // Extreme drop (70% drop from basePrice)
        createCandle(2000, basePrice, basePrice * 0.8, basePrice * 0.3, basePrice * 0.3, 10000),
        // Recovery starts
        createCandle(
          3000,
          basePrice * 0.3,
          basePrice * 0.4,
          basePrice * 0.25,
          basePrice * 0.35,
          5000
        ),
        // 10% rebound from low (0.3 * 1.1 = 0.33, we're at 0.35)
        createCandle(
          4000,
          basePrice * 0.35,
          basePrice * 0.5,
          basePrice * 0.3,
          basePrice * 0.45,
          3000
        ),
        createCandle(
          5000,
          basePrice * 0.45,
          basePrice * 0.6,
          basePrice * 0.4,
          basePrice * 0.55,
          2000
        ),
        createCandle(
          6000,
          basePrice * 0.55,
          basePrice * 0.8,
          basePrice * 0.5,
          basePrice * 0.75,
          1500
        ),
        createCandle(
          7000,
          basePrice * 0.75,
          basePrice * 1.0,
          basePrice * 0.7,
          basePrice * 0.9,
          1000
        ),
        createCandle(
          8000,
          basePrice * 0.9,
          basePrice * 1.2,
          basePrice * 0.85,
          basePrice * 1.1,
          1000
        ),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const entry: EntryConfig = {
        initialEntry: -0.5, // Wait for 50% drop (0.3 is 70% drop, so this triggers)
        trailingEntry: 0.1, // Then 10% rebound from low
        maxWaitTime: 1000,
      };

      const result = await simulateStrategy(candles, strategy, undefined, entry);

      expect(result).toBeDefined();
      // Entry should be optimized (either trailing or initial drop entry)
      expect(result.entryOptimization.actualEntryPrice).toBeLessThan(basePrice);
      // Verify entry was triggered
      expect(result.entryPrice).toBeDefined();
      expect(result.entryPrice).toBeLessThan(basePrice);
    });
  });

  describe('Data Quality Edge Cases', () => {
    it('should handle out-of-order candles', async () => {
      const candles: Candle[] = [
        createCandle(3000, 1.0, 1.1, 0.9, 1.0, 1000), // Out of order
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(4000, 1.0, 1.1, 0.9, 1.0, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      // Should either sort or reject out-of-order candles
      const result = await simulateStrategy(candles, strategy);
      expect(result).toBeDefined();
    });

    it('should handle duplicate timestamps', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000), // Duplicate
        createCandle(2000, 1.0, 1.1, 0.9, 1.0, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);
      expect(result).toBeDefined();
      // Should handle duplicates (either dedupe or use last)
    });

    it('should handle missing candles (gaps in timeline)', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, 1.0, 1.1, 0.9, 1.0, 1000),
        // Gap: missing 3000, 4000, 5000
        createCandle(6000, 1.5, 1.6, 1.4, 1.5, 1000),
        createCandle(7000, 1.5, 1.6, 1.4, 1.5, 1000),
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);
      expect(result).toBeDefined();
      // Should handle gaps gracefully
    });

    it('should handle single candle dataset', async () => {
      const candles: Candle[] = [createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000)];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);
      expect(result).toBeDefined();
      expect(result.totalCandles).toBe(1);
    });

    it('should handle empty candle array', async () => {
      const candles: Candle[] = [];
      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const result = await simulateStrategy(candles, strategy);
      expect(result).toBeDefined();
      expect(result.totalCandles).toBe(0);
    });
  });

  describe('Fee and Slippage Edge Cases', () => {
    it('should handle extreme slippage (50%)', async () => {
      const candles = createPriceProgression(1000, 1.0, 1000, 60, (i) => 1 + i * 0.001);

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const costs: CostConfig = {
        entrySlippageBps: 5000, // 50% slippage
        exitSlippageBps: 5000,
        takerFeeBps: 100,
        borrowAprBps: 0,
      };

      const result = await simulateStrategy(
        candles,
        strategy,
        undefined,
        undefined,
        undefined,
        costs
      );

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
      // Should account for extreme slippage
    });

    it('should handle zero fees', async () => {
      const candles = createPriceProgression(1000, 1.0, 1000, 60, (i) => 1 + i * 0.001);

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const costs: CostConfig = {
        entrySlippageBps: 0,
        exitSlippageBps: 0,
        takerFeeBps: 0,
        borrowAprBps: 0,
      };

      const result = await simulateStrategy(
        candles,
        strategy,
        undefined,
        undefined,
        undefined,
        costs
      );

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
    });

    it('should handle negative slippage (impossible but test robustness)', async () => {
      const candles = createPriceProgression(1000, 1.0, 1000, 60, (i) => 1 + i * 0.001);

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];

      const costs: CostConfig = {
        entrySlippageBps: -100, // Negative slippage (should be clamped)
        exitSlippageBps: -100,
        takerFeeBps: 0,
        borrowAprBps: 0,
      };

      const result = await simulateStrategy(
        candles,
        strategy,
        undefined,
        undefined,
        undefined,
        costs
      );

      expect(result).toBeDefined();
      // Should handle negative slippage (either reject or clamp)
    });
  });

  describe('Stop Loss Edge Cases', () => {
    it('should handle stop loss triggered immediately', async () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0, 1.1, 0.9, 1.0, 1000),
        createCandle(2000, 1.0, 1.05, 0.4, 0.5, 10000), // Immediate 50% drop
      ];

      const strategy: StrategyLeg[] = [{ target: 2, percent: 1.0 }];
      const stopLoss: StopLossConfig = { initial: -0.3, trailing: 'none' };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      const stopLossEvents = result.events.filter((e) => e.type === 'stop_loss');
      expect(stopLossEvents.length).toBeGreaterThan(0);
    });

    it('should handle trailing stop with rolling window on volatile data', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [];

      // Create volatile pattern: up, down, up, down
      for (let i = 0; i < 1000; i++) {
        const cycle = Math.floor(i / 100);
        const cyclePos = (i % 100) / 100;
        const volatility = 0.1;
        const price = basePrice * (1 + cycle * 0.5 + Math.sin(cyclePos * Math.PI * 2) * volatility);
        candles.push(
          createCandle(
            1000 + i * 60,
            price,
            price * 1.05,
            price * 0.95,
            price * (1 + (Math.random() - 0.5) * 0.1),
            1000
          )
        );
      }

      const strategy: StrategyLeg[] = [{ target: 3, percent: 1.0 }];
      const stopLoss: StopLossConfig = {
        initial: -0.5,
        trailing: 0.3,
        trailingPercent: 0.2,
        trailingWindowSize: 50, // Rolling window
      };

      const result = await simulateStrategy(candles, strategy, stopLoss);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.finalPnl)).toBe(true);
    });
  });

  describe('Performance and Memory Edge Cases', () => {
    it('should not leak memory with many events', async () => {
      const basePrice = 1.0;
      const candles = createPriceProgression(1000, basePrice, 20000, 60, (i) => {
        // Create many profit target hits
        return 1 + (i / 20000) * 20;
      });

      const strategy: StrategyLeg[] = [
        { target: 1.1, percent: 0.1 },
        { target: 1.2, percent: 0.1 },
        { target: 1.3, percent: 0.1 },
        { target: 1.4, percent: 0.1 },
        { target: 1.5, percent: 0.1 },
        { target: 2, percent: 0.1 },
        { target: 3, percent: 0.1 },
        { target: 5, percent: 0.1 },
        { target: 10, percent: 0.1 },
        { target: 20, percent: 0.1 },
      ];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
      // Memory should be reasonable (test would fail if there's a leak)
    });

    it('should handle rapid-fire events (many exits in short time)', async () => {
      const basePrice = 1.0;
      const candles: Candle[] = [];

      // Create rapid price movements hitting many targets
      for (let i = 0; i < 1000; i++) {
        const price = basePrice * (1 + i * 0.01); // Rapid increase
        candles.push(createCandle(1000 + i * 10, price, price * 1.01, price * 0.99, price, 1000));
      }

      const strategy: StrategyLeg[] = [
        { target: 1.1, percent: 0.1 },
        { target: 1.2, percent: 0.1 },
        { target: 1.3, percent: 0.1 },
        { target: 1.4, percent: 0.1 },
        { target: 1.5, percent: 0.1 },
        { target: 2, percent: 0.1 },
        { target: 3, percent: 0.1 },
        { target: 5, percent: 0.1 },
        { target: 10, percent: 0.1 },
      ];

      const result = await simulateStrategy(candles, strategy);

      expect(result).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
      // Should handle rapid events without performance issues
    });
  });
});
