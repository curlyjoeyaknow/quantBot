import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { SimulationService } from '../../src/services/SimulationService';
import { fetchHybridCandles } from '../../src/simulation/candles';
import { simulateStrategy } from '../../src/simulate';
import * as db from '../../src/utils/database';
import { eventBus, EventFactory } from '../../src/events';

// Mock dependencies
vi.mock('../../src/simulation/candles', () => ({
  fetchHybridCandles: vi.fn(),
}));

vi.mock('../../src/simulate', () => ({
  simulateStrategy: vi.fn(),
}));

vi.mock('../../src/utils/database', () => ({
  saveSimulationRun: vi.fn(),
  getUserSimulationRuns: vi.fn(),
  getSimulationRun: vi.fn(),
}));

vi.mock('../../src/events', () => ({
  eventBus: {
    publish: vi.fn(),
  },
  EventFactory: {
    createUserEvent: vi.fn((type, data, source, userId) => ({
      type,
      data,
      source,
      userId,
    })),
  },
}));

describe('simulation-service', () => {
  let service: SimulationService;

  beforeEach(() => {
    service = new SimulationService();
    vi.clearAllMocks();
  });

  describe('runSimulation', () => {
    it('should run simulation successfully', async () => {
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        { timestamp: 1060, open: 1.05, high: 1.15, low: 0.95, close: 1.1, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.1,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.1,
        totalCandles: 2,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);

      const params = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        userId: 123,
      };

      const result = await service.runSimulation(params);

      expect(result).toEqual(mockResult);
      expect(fetchHybridCandles).toHaveBeenCalled();
      expect(simulateStrategy).toHaveBeenCalled();
      expect(eventBus.publish).toHaveBeenCalledTimes(2); // started and completed
    });

    it('should throw error when no candles available', async () => {
      vi.mocked(fetchHybridCandles).mockResolvedValue([]);

      const params = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        userId: 123,
      };

      await expect(service.runSimulation(params)).rejects.toThrow(
        'No candle data available',
      );

      expect(eventBus.publish).toHaveBeenCalledTimes(2); // started and failed
    });

    it('should use current time when endTime not provided', async () => {
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.0,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);

      const params = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        userId: 123,
      };

      await service.runSimulation(params);

      expect(fetchHybridCandles).toHaveBeenCalled();
    });
  });

  describe('saveSimulationRun', () => {
    it('should save simulation run', async () => {
      vi.mocked(db.saveSimulationRun).mockResolvedValue(1);

      const params = {
        userId: 123,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        finalPnl: 1.1,
        totalCandles: 2,
        events: [],
      };

      const id = await service.saveSimulationRun(params);

      expect(id).toBe(1);
      expect(db.saveSimulationRun).toHaveBeenCalledWith(params);
    });
  });

  describe('getUserSimulationRuns', () => {
    it('should return user simulation runs', async () => {
      const mockRuns = [
        {
          id: 1,
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
          strategy: [{ target: 2, percent: 1.0 }],
          stopLossConfig: { initial: -0.2 },
          finalPnl: 1.1,
          totalCandles: 2,
        },
      ];

      vi.mocked(db.getUserSimulationRuns).mockResolvedValue(mockRuns as any);

      const runs = await service.getUserSimulationRuns(123, 10);

      expect(runs).toEqual(mockRuns);
      expect(db.getUserSimulationRuns).toHaveBeenCalledWith(123, 10);
    });
  });

  describe('getSimulationRun', () => {
    it('should return simulation run by ID', async () => {
      const mockRun = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        finalPnl: 1.1,
        totalCandles: 2,
        createdAt: DateTime.fromSeconds(3000),
      };

      vi.mocked(db.getSimulationRun).mockResolvedValue(mockRun as any);

      const run = await service.getSimulationRun(1);

      expect(run).toEqual(mockRun);
      expect(db.getSimulationRun).toHaveBeenCalledWith(1);
    });
  });

  describe('runAndSaveSimulation', () => {
    it('should run and save simulation', async () => {
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.1,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.05,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);
      vi.mocked(db.saveSimulationRun).mockResolvedValue(1);

      const params = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        userId: 123,
      };

      const result = await service.runAndSaveSimulation(params);

      expect(result.runId).toBe(1);
      expect(result.finalPnl).toBe(1.1);
    });
  });

  describe('repeatSimulation', () => {
    it('should repeat simulation by index', async () => {
      const mockRuns = [
        {
          id: 1,
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          startTime: DateTime.fromSeconds(1000),
          endTime: DateTime.fromSeconds(2000),
          strategy: [{ target: 2, percent: 1.0 }],
          stopLossConfig: { initial: -0.2 },
        },
      ];

      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.1,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.05,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(db.getUserSimulationRuns).mockResolvedValue(mockRuns as any);
      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);

      const result = await service.repeatSimulation(123, 1);

      expect(result).toEqual(mockResult);
    });

    it('should repeat simulation by run ID', async () => {
      const mockRun = {
        id: 100,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        createdAt: DateTime.fromSeconds(3000),
      };

      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.1,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.05,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(db.getSimulationRun).mockResolvedValue(mockRun as any);
      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);

      const result = await service.repeatSimulation(123, 100);

      expect(result).toEqual(mockResult);
    });

    it('should throw error when run not found by index', async () => {
      vi.mocked(db.getUserSimulationRuns).mockResolvedValue([]);

      await expect(service.repeatSimulation(123, 1)).rejects.toThrow(
        'No simulation run found at index 1',
      );
    });

    it('should throw error when run not found by ID', async () => {
      vi.mocked(db.getSimulationRun).mockResolvedValue(null);

      await expect(service.repeatSimulation(123, 100)).rejects.toThrow(
        'Simulation run 100 not found',
      );
    });
  });
});


