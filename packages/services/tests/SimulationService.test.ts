/**
 * @file SimulationService.test.ts
 * @description
 * Comprehensive unit tests for SimulationService covering simulation execution,
 * database integration, repeat logic, and error handling.
 */

import { SimulationService, SimulationParams } from '../../src/services/SimulationService';
import { SimulationRunData } from '../../src/types/session';
import { DateTime } from 'luxon';
import { fetchHybridCandles } from '../../src/simulation/candles';
import { simulateStrategy } from '../../src/simulation/engine';
import * as db from '../../src/utils/database';

// Mock dependencies
jest.mock('../../src/simulation/candles');
jest.mock('../../src/simulation/engine');
jest.mock('../../src/utils/database');

const mockFetchHybridCandles = fetchHybridCandles as jest.MockedFunction<typeof fetchHybridCandles>;
const mockSimulateStrategy = simulateStrategy as jest.MockedFunction<typeof simulateStrategy>;
const mockDb = db as jest.Mocked<typeof db>;

describe('SimulationService', () => {
  let simulationService: SimulationService;

  beforeEach(() => {
    jest.clearAllMocks();
    simulationService = new SimulationService();
  });

  describe('Simulation Execution', () => {
    const mockSimulationParams: SimulationParams = {
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      startTime: DateTime.utc().minus({ hours: 24 }),
      endTime: DateTime.utc(),
      strategy: [
        { percent: 0.5, target: 2 },
        { percent: 0.3, target: 5 },
        { percent: 0.2, target: 10 }
      ],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
      userId: 12345
    };

    const mockCandles = [
      { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      { timestamp: 1060, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
      { timestamp: 1120, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 }
    ];

    const mockSimulationResult = {
      finalPnl: 2.5,
      events: [
        { type: 'entry' as const, timestamp: 1000, price: 1.0, description: 'Entry at $1.00', remainingPosition: 1, pnlSoFar: 1 },
        { type: 'target_hit' as const, timestamp: 1060, price: 2.0, description: '50% sold at 2x', remainingPosition: 0.5, pnlSoFar: 1.5 },
        { type: 'final_exit' as const, timestamp: 1120, price: 2.5, description: 'Final exit', remainingPosition: 0, pnlSoFar: 2.5 }
      ],
      entryPrice: 1.0,
      finalPrice: 2.5,
      totalCandles: 3,
      entryOptimization: {
        lowestPrice: 0.9,
        lowestPriceTimestamp: 1000,
        lowestPricePercent: -10,
        lowestPriceTimeFromEntry: 0,
        trailingEntryUsed: false,
        actualEntryPrice: 1.0,
        entryDelay: 0
      }
    };

    it('should run simulation with valid parameters', async () => {
      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockSimulationResult);

      const result = await simulationService.runSimulation(mockSimulationParams);

      expect(result).toEqual(mockSimulationResult);
      expect(mockFetchHybridCandles).toHaveBeenCalledWith(
        mockSimulationParams.mint,
        mockSimulationParams.startTime,
        mockSimulationParams.endTime,
        mockSimulationParams.chain
      );
      expect(mockSimulateStrategy).toHaveBeenCalledWith(
        mockCandles,
        mockSimulationParams.strategy,
        mockSimulationParams.stopLossConfig
      );
    });

    it('should handle missing candle data', async () => {
      mockFetchHybridCandles.mockResolvedValue([]);

      await expect(simulationService.runSimulation(mockSimulationParams))
        .rejects.toThrow('No candle data available for simulation period');
    });

    it('should handle API failures gracefully', async () => {
      const apiError = new Error('Birdeye API rate limit exceeded');
      mockFetchHybridCandles.mockRejectedValue(apiError);

      await expect(simulationService.runSimulation(mockSimulationParams))
        .rejects.toThrow('Birdeye API rate limit exceeded');
    });

    it('should validate simulation results structure', async () => {
      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockSimulationResult);

      const result = await simulationService.runSimulation(mockSimulationParams);

      expect(result).toHaveProperty('finalPnl');
      expect(result).toHaveProperty('events');
      expect(result).toHaveProperty('entryPrice');
      expect(result).toHaveProperty('finalPrice');
      expect(result).toHaveProperty('totalCandles');
      expect(result).toHaveProperty('entryOptimization');
      expect(Array.isArray(result.events)).toBe(true);
      expect(typeof result.finalPnl).toBe('number');
    });

    it('should use current time as end time when not provided', async () => {
      const paramsWithoutEndTime = { ...mockSimulationParams };
      delete paramsWithoutEndTime.endTime;

      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockSimulationResult);

      await simulationService.runSimulation(paramsWithoutEndTime);

      expect(mockFetchHybridCandles).toHaveBeenCalledWith(
        mockSimulationParams.mint,
        mockSimulationParams.startTime,
        expect.any(DateTime), // Should be current time
        mockSimulationParams.chain
      );
    });
  });

  describe('Database Integration', () => {
    const mockSimulationData = {
      userId: 12345,
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      startTime: DateTime.utc().minus({ hours: 24 }),
      endTime: DateTime.utc(),
      strategy: [{ percent: 1, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
      finalPnl: 2.0,
      totalCandles: 100,
      events: [{ type: 'entry' as const, timestamp: 1000, price: 1.0, description: 'Entry', remainingPosition: 1, pnlSoFar: 1 }]
    };

    it('should save simulation run to database', async () => {
      const expectedRunId = 1;
      mockDb.saveSimulationRun.mockResolvedValue(expectedRunId);

      const result = await simulationService.saveSimulationRun(mockSimulationData);

      expect(result).toBe(expectedRunId);
      expect(mockDb.saveSimulationRun).toHaveBeenCalledWith(mockSimulationData);
    });

    it('should handle simulation save errors', async () => {
      const error = new Error('Database save failed');
      mockDb.saveSimulationRun.mockRejectedValue(error);

      await expect(simulationService.saveSimulationRun(mockSimulationData))
        .rejects.toThrow('Database save failed');
    });

    it('should retrieve user simulation runs', async () => {
      const userId = 12345;
      const limit = 10;
      const mockRuns: SimulationRunData[] = [
        {
          id: 1,
          mint: 'mint1',
          chain: 'solana',
          tokenName: 'Token 1',
          tokenSymbol: 'T1',
          startTime: DateTime.utc().minus({ hours: 24 }),
          endTime: DateTime.utc(),
          strategy: [{ percent: 1, target: 2 }],
          stopLossConfig: { initial: -0.3, trailing: 0.5 },
          finalPnl: 2.0,
          totalCandles: 100,
          events: [],
          createdAt: DateTime.utc()
        }
      ];

      mockDb.getUserSimulationRuns.mockResolvedValue(mockRuns);

      const result = await simulationService.getUserSimulationRuns(userId, limit);

      expect(result).toEqual(mockRuns);
      expect(mockDb.getUserSimulationRuns).toHaveBeenCalledWith(userId, limit);
    });

    it('should handle simulation run retrieval errors', async () => {
      const userId = 12345;
      const error = new Error('Database retrieval failed');
      mockDb.getUserSimulationRuns.mockRejectedValue(error);

      await expect(simulationService.getUserSimulationRuns(userId))
        .rejects.toThrow('Database retrieval failed');
    });

    it('should get specific simulation run by ID', async () => {
      const runId = 1;
      const mockRun: SimulationRunData = {
        id: runId,
        mint: 'mint1',
        chain: 'solana',
        tokenName: 'Token 1',
        tokenSymbol: 'T1',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        finalPnl: 2.0,
        totalCandles: 100,
        events: [],
        createdAt: DateTime.utc()
      };

      mockDb.getSimulationRun.mockResolvedValue(mockRun);

      const result = await simulationService.getSimulationRun(runId);

      expect(result).toEqual(mockRun);
      expect(mockDb.getSimulationRun).toHaveBeenCalledWith(runId);
    });

    it('should return null for non-existent simulation run', async () => {
      const runId = 999;
      mockDb.getSimulationRun.mockResolvedValue(null);

      const result = await simulationService.getSimulationRun(runId);

      expect(result).toBeNull();
    });

    it('should run and save simulation in single transaction', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const mockCandles = [{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }];
      const mockResult = {
        finalPnl: 2.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 2.0,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0
        }
      };

      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockResult);
      mockDb.saveSimulationRun.mockResolvedValue(1);

      const result = await simulationService.runAndSaveSimulation(params);

      expect(result).toEqual({ ...mockResult, runId: 1 });
      expect(mockDb.saveSimulationRun).toHaveBeenCalledWith({
        userId: params.userId,
        mint: params.mint,
        chain: params.chain,
        startTime: params.startTime,
        endTime: params.endTime,
        strategy: params.strategy,
        stopLossConfig: params.stopLossConfig,
        finalPnl: mockResult.finalPnl,
        totalCandles: mockResult.totalCandles,
        events: mockResult.events
      });
    });
  });

  describe('Repeat Simulation Logic', () => {
    const mockRun: SimulationRunData = {
      id: 1,
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      startTime: DateTime.utc().minus({ hours: 24 }),
      endTime: DateTime.utc(),
      strategy: [{ percent: 1, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
      finalPnl: 2.0,
      totalCandles: 100,
      events: [],
      createdAt: DateTime.utc()
    };

    it('should repeat simulation by index (1-99)', async () => {
      const userId = 12345;
      const index = 1; // Second run (0-indexed)
      const mockRuns = [mockRun, { ...mockRun, id: 2, events: [] }];

      mockDb.getUserSimulationRuns.mockResolvedValue(mockRuns);
      mockFetchHybridCandles.mockResolvedValue([{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }]);
      mockSimulateStrategy.mockReturnValue({
        finalPnl: 2.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 2.0,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0
        }
      });

      const result = await simulationService.repeatSimulation(userId, index);

      expect(result).toBeDefined();
      expect(mockDb.getUserSimulationRuns).toHaveBeenCalledWith(userId, 100);
      expect(mockFetchHybridCandles).toHaveBeenCalledWith(
        mockRuns[index - 1].mint,
        mockRuns[index - 1].startTime,
        mockRuns[index - 1].endTime,
        mockRuns[index - 1].chain
      );
    });

    it('should repeat simulation by ID (100+)', async () => {
      const userId = 12345;
      const runId = 100;

      mockDb.getSimulationRun.mockResolvedValue(mockRun);
      mockFetchHybridCandles.mockResolvedValue([{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }]);
      mockSimulateStrategy.mockReturnValue({
        finalPnl: 2.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 2.0,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0
        }
      });

      const result = await simulationService.repeatSimulation(userId, runId);

      expect(result).toBeDefined();
      expect(mockDb.getSimulationRun).toHaveBeenCalledWith(runId);
      expect(mockFetchHybridCandles).toHaveBeenCalledWith(
        mockRun.mint,
        mockRun.startTime,
        mockRun.endTime,
        mockRun.chain
      );
    });

    it('should handle non-existent run by index', async () => {
      const userId = 12345;
      const index = 5;
      const mockRuns: SimulationRunData[] = [mockRun]; // Only 1 run available

      mockDb.getUserSimulationRuns.mockResolvedValue(mockRuns);

      await expect(simulationService.repeatSimulation(userId, index))
        .rejects.toThrow(`No simulation run found at index ${index}`);
    });

    it('should handle non-existent run by ID', async () => {
      const userId = 12345;
      const runId = 999;

      mockDb.getSimulationRun.mockResolvedValue(null);

      await expect(simulationService.repeatSimulation(userId, runId))
        .rejects.toThrow(`Simulation run ${runId} not found`);
    });

    it('should preserve original parameters when repeating', async () => {
      const userId = 12345;
      const index = 1;
      const mockRuns: SimulationRunData[] = [mockRun];

      mockDb.getUserSimulationRuns.mockResolvedValue(mockRuns);
      mockFetchHybridCandles.mockResolvedValue([{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }]);
      mockSimulateStrategy.mockReturnValue({
        finalPnl: 2.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 2.0,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0
        }
      });

      await simulationService.repeatSimulation(userId, index);

      expect(mockSimulateStrategy).toHaveBeenCalledWith(
        expect.any(Array),
        mockRun.strategy,
        mockRun.stopLossConfig
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid mint addresses', async () => {
      const params: SimulationParams = {
        mint: 'invalid-mint',
        chain: 'solana',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const error = new Error('Invalid mint address');
      mockFetchHybridCandles.mockRejectedValue(error);

      await expect(simulationService.runSimulation(params))
        .rejects.toThrow('Invalid mint address');
    });

    it('should handle unsupported chains', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'unsupported-chain',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const error = new Error('Unsupported chain');
      mockFetchHybridCandles.mockRejectedValue(error);

      await expect(simulationService.runSimulation(params))
        .rejects.toThrow('Unsupported chain');
    });

    it('should handle date range validation', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().plus({ hours: 1 }), // Future start time
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const error = new Error('Start time cannot be in the future');
      mockFetchHybridCandles.mockRejectedValue(error);

      await expect(simulationService.runSimulation(params))
        .rejects.toThrow('Start time cannot be in the future');
    });

    it('should handle strategy validation', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [], // Empty strategy
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const error = new Error('Strategy cannot be empty');
      mockSimulateStrategy.mockImplementation(() => {
        throw error;
      });
      mockFetchHybridCandles.mockResolvedValue([{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }]);

      await expect(simulationService.runSimulation(params))
        .rejects.toThrow('Strategy cannot be empty');
    });

    it('should handle network timeouts', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const timeoutError = new Error('Request timeout');
      mockFetchHybridCandles.mockRejectedValue(timeoutError);

      await expect(simulationService.runSimulation(params))
        .rejects.toThrow('Request timeout');
    });
  });

  describe('Edge Cases', () => {
    it('should handle simulations with no events', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const mockCandles = [{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }];
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
          entryDelay: 0
        }
      };

      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockResult);

      const result = await simulationService.runSimulation(params);

      expect(result.events).toEqual([]);
      expect(result.finalPnl).toBe(1.0);
    });

    it('should handle simulations with negative PNL', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().minus({ hours: 24 }),
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const mockCandles = [{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 0.7, volume: 1000 }];
      const mockResult = {
        finalPnl: 0.7,
        events: [
          { type: 'entry' as const, timestamp: 1000, price: 1.0, description: 'Entry at $1.00', remainingPosition: 1, pnlSoFar: 1 },
          { type: 'stop_loss' as const, timestamp: 1100, price: 0.7, description: 'Stop loss triggered', remainingPosition: 0, pnlSoFar: 0.7 }
        ],
        entryPrice: 1.0,
        finalPrice: 0.7,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.7,
          lowestPriceTimestamp: 1100,
          lowestPricePercent: -30,
          lowestPriceTimeFromEntry: 100,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0
        }
      };

      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockResult);

      const result = await simulationService.runSimulation(params);

      expect(result.finalPnl).toBe(0.7);
      expect(result.events).toHaveLength(2);
    });

    it('should handle very long simulation periods', async () => {
      const params: SimulationParams = {
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.utc().minus({ days: 30 }), // 30 days ago
        endTime: DateTime.utc(),
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        userId: 12345
      };

      const mockCandles = Array(1000).fill(null).map((_, i) => ({
        timestamp: 1000 + i * 60,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000
      }));

      const mockResult = {
        finalPnl: 2.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 2.0,
        totalCandles: 1000,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0
        }
      };

      mockFetchHybridCandles.mockResolvedValue(mockCandles);
      mockSimulateStrategy.mockReturnValue(mockResult);

      const result = await simulationService.runSimulation(params);

      expect(result.totalCandles).toBe(1000);
      expect(mockFetchHybridCandles).toHaveBeenCalledWith(
        params.mint,
        params.startTime,
        params.endTime,
        params.chain
      );
    });
  });
});
