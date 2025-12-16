import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { SimulationEngine, type SimulationTarget } from '../src/engine';
import type { Candle } from '@quantbot/core';
import type {
  SimulationScenarioConfig,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../src/config';

describe('simulation-engine-class', () => {
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

  describe('SimulationEngine', () => {
    it('should create engine with default dependencies', () => {
      const engine = new SimulationEngine();
      expect(engine).toBeDefined();
    });

    it('should run scenario with pre-fetched candles', async () => {
      const engine = new SimulationEngine();

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const candlesMap = new Map([[targets[0], candles]]);

      const result = await engine.runScenario({ scenario, targets, candlesMap });

      expect(result.successes).toBe(1);
    });

    it('should use custom sinks', async () => {
      const mockSink = {
        name: 'test-sink',
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const engine = new SimulationEngine({
        sinks: [mockSink],
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const candlesMap = new Map([[targets[0], candles]]);

      await engine.runScenario({ scenario, targets, candlesMap });

      expect(mockSink.handle).toHaveBeenCalled();
    });

    it('should handle multiple targets with concurrency', async () => {
      const engine = new SimulationEngine();

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
        {
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      const candles1 = createCandleSeries([1, 2, 3, 4, 5]);
      const candles2 = createCandleSeries([1, 2, 3, 4, 5]);
      const candlesMap = new Map([
        [targets[0], candles1],
        [targets[1], candles2],
      ]);

      const result = await engine.runScenario({
        scenario,
        targets,
        candlesMap,
        runOptions: { maxConcurrency: 2 },
      });

      expect(result.totalTargets).toBe(2);
      expect(result.successes).toBe(2);
    });

    it('should handle target failures gracefully', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const engine = new SimulationEngine({
        logger: mockLogger as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      // Provide empty candles map to trigger error
      const candlesMap = new Map();

      const result = await engine.runScenario({
        scenario,
        targets,
        candlesMap,
        runOptions: { failFast: false },
      });

      expect(result.failures).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should fail fast when configured', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const engine = new SimulationEngine({
        logger: mockLogger as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      // Provide empty candles map to trigger error
      const candlesMap = new Map();

      await expect(
        engine.runScenario({
          scenario,
          targets,
          candlesMap,
          runOptions: { failFast: true },
        })
      ).rejects.toThrow();

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should merge scenario configs with overrides', async () => {
      const customStopLoss: StopLossConfig = { initial: -0.2 };
      const engine = new SimulationEngine({
        defaults: {
          stopLoss: customStopLoss,
        },
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const candlesMap = new Map([[targets[0], candles]]);

      const result = await engine.runScenario({
        scenario,
        targets,
        candlesMap,
        overrides: {
          stopLoss: { initial: -0.3 },
        },
      });

      expect(result.successes).toBe(1);
    });

    it('should log progress at intervals', async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const engine = new SimulationEngine({
        logger: mockLogger as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets: SimulationTarget[] = Array(5)
        .fill(null)
        .map((_, i) => ({
          mint: `mint${i}`,
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        }));

      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const candlesMap = new Map(targets.map((target) => [target, candles]));

      await engine.runScenario({
        scenario,
        targets,
        candlesMap,
        runOptions: { progressInterval: 2 },
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Simulation progress',
        expect.objectContaining({
          scenario: 'test',
        })
      );
    });
  });
});
