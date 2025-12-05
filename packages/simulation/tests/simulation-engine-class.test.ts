import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { SimulationEngine } from '../../src/simulation/engine';
import type { Candle } from '../../src/simulation/candles';
import type { SimulationScenarioConfig, StopLossConfig, EntryConfig, ReEntryConfig, CostConfig } from '../../src/simulation/config';

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

    it('should create engine with custom data provider', async () => {
      const mockProvider = {
        fetchCandles: vi.fn().mockResolvedValue(createCandleSeries([1, 2, 3, 4, 5])),
      };

      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      await engine.runScenario({ scenario, targets });

      expect(mockProvider.fetchCandles).toHaveBeenCalled();
    });

    it('should use custom sinks', async () => {
      const mockSink = {
        name: 'test-sink',
        handle: vi.fn().mockResolvedValue(undefined),
      };

      const mockProvider = {
        fetchCandles: vi.fn().mockResolvedValue(createCandleSeries([1, 2, 3, 4, 5])),
      };

      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
        sinks: [mockSink],
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      await engine.runScenario({ scenario, targets });

      expect(mockSink.handle).toHaveBeenCalled();
    });

    it('should handle multiple targets with concurrency', async () => {
      const mockProvider = {
        fetchCandles: vi.fn().mockResolvedValue(createCandleSeries([1, 2, 3, 4, 5])),
      };

      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = [
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

      const result = await engine.runScenario({
        scenario,
        targets,
        runOptions: { maxConcurrency: 2 },
      });

      expect(result.totalTargets).toBe(2);
      expect(result.successes).toBe(2);
      expect(mockProvider.fetchCandles).toHaveBeenCalledTimes(2);
    });

    it('should handle target failures gracefully', async () => {
      const mockProvider = {
        fetchCandles: vi.fn().mockRejectedValue(new Error('No data')),
      };

      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      const result = await engine.runScenario({
        scenario,
        targets,
        runOptions: { failFast: false },
      });

      expect(result.failures).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should fail fast when configured', async () => {
      const mockProvider = {
        fetchCandles: vi.fn().mockRejectedValue(new Error('No data')),
      };

      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      await expect(
        engine.runScenario({
          scenario,
          targets,
          runOptions: { failFast: true },
        }),
      ).rejects.toThrow('No data');
    });

    it('should merge scenario configs with overrides', async () => {
      const mockProvider = {
        fetchCandles: vi.fn().mockResolvedValue(createCandleSeries([1, 2, 3, 4, 5])),
      };

      const customStopLoss: StopLossConfig = { initial: -0.2 };
      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
        defaults: {
          stopLoss: customStopLoss,
        },
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
        },
      ];

      const result = await engine.runScenario({
        scenario,
        targets,
        overrides: {
          stopLoss: { initial: -0.3 },
        },
      });

      expect(result.successes).toBe(1);
    });

    it('should log progress at intervals', async () => {
      const mockProvider = {
        fetchCandles: vi.fn().mockResolvedValue(createCandleSeries([1, 2, 3, 4, 5])),
      };

      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const engine = new SimulationEngine({
        dataProvider: mockProvider as any,
        logger: mockLogger as any,
      });

      const scenario: SimulationScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };

      const targets = Array(5).fill(null).map((_, i) => ({
        mint: `mint${i}`,
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
      }));

      await engine.runScenario({
        scenario,
        targets,
        runOptions: { progressInterval: 2 },
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Simulation progress',
        expect.objectContaining({
          scenario: 'test',
        }),
      );
    });
  });
});

