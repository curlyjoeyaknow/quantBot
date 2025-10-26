/**
 * @file StrategyService.test.ts
 * @description
 * Comprehensive unit tests for StrategyService covering CRUD operations,
 * validation, default strategy management, and edge cases.
 */

import { StrategyService, StrategyData, SavedStrategy } from '../../src/services/StrategyService';
import * as db from '../../src/utils/database';

// Mock the database module
jest.mock('../../src/utils/database');
const mockDb = db as jest.Mocked<typeof db>;

describe('StrategyService', () => {
  let strategyService: StrategyService;

  beforeEach(() => {
    jest.clearAllMocks();
    strategyService = new StrategyService();
  });

  describe('Strategy CRUD Operations', () => {
    const mockStrategyData: StrategyData = {
      name: 'test-strategy',
      description: 'Test strategy for unit testing',
      strategy: [
        { percent: 0.5, target: 2 },
        { percent: 0.3, target: 5 },
        { percent: 0.2, target: 10 }
      ],
      stopLossConfig: { initial: -0.3, trailing: 0.5 }
    };

    it('should save a new strategy successfully', async () => {
      const userId = 12345;
      const expectedId = 1;

      mockDb.saveStrategy.mockResolvedValue(expectedId);

      const result = await strategyService.saveStrategy(userId, mockStrategyData);

      expect(result).toBe(expectedId);
      expect(mockDb.saveStrategy).toHaveBeenCalledWith({
        userId,
        ...mockStrategyData
      });
    });

    it('should handle strategy save errors', async () => {
      const userId = 12345;
      const error = new Error('Database save failed');

      mockDb.saveStrategy.mockRejectedValue(error);

      await expect(strategyService.saveStrategy(userId, mockStrategyData))
        .rejects.toThrow('Database save failed');
    });

    it('should get all strategies for a user', async () => {
      const userId = 12345;
      const mockStrategies: SavedStrategy[] = [
        {
          id: 1,
          name: 'strategy-1',
          description: 'First strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.2, trailing: 0.3 },
          isDefault: false,
          createdAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          name: 'strategy-2',
          description: 'Second strategy',
          strategy: [{ percent: 1, target: 1.5 }],
          stopLossConfig: { initial: -0.1, trailing: 'none' },
          isDefault: true,
          createdAt: '2024-01-02T00:00:00Z'
        }
      ];

      mockDb.getUserStrategies.mockResolvedValue(mockStrategies);

      const result = await strategyService.getUserStrategies(userId);

      expect(result).toEqual(mockStrategies);
      expect(mockDb.getUserStrategies).toHaveBeenCalledWith(userId);
    });

    it('should handle strategy retrieval errors', async () => {
      const userId = 12345;
      const error = new Error('Database retrieval failed');

      mockDb.getUserStrategies.mockRejectedValue(error);

      await expect(strategyService.getUserStrategies(userId))
        .rejects.toThrow('Database retrieval failed');
    });

    it('should get a specific strategy by name', async () => {
      const userId = 12345;
      const strategyName = 'test-strategy';
      const mockStrategy: SavedStrategy = {
        id: 1,
        name: strategyName,
        description: 'Test strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 },
        isDefault: false,
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockDb.getStrategy.mockResolvedValue(mockStrategy);

      const result = await strategyService.getStrategy(userId, strategyName);

      expect(result).toEqual(mockStrategy);
      expect(mockDb.getStrategy).toHaveBeenCalledWith(userId, strategyName);
    });

    it('should return null for non-existent strategy', async () => {
      const userId = 12345;
      const strategyName = 'non-existent';

      mockDb.getStrategy.mockResolvedValue(null);

      const result = await strategyService.getStrategy(userId, strategyName);

      expect(result).toBeNull();
      expect(mockDb.getStrategy).toHaveBeenCalledWith(userId, strategyName);
    });

    it('should handle strategy retrieval errors', async () => {
      const userId = 12345;
      const strategyName = 'test-strategy';
      const error = new Error('Database retrieval failed');

      mockDb.getStrategy.mockRejectedValue(error);

      await expect(strategyService.getStrategy(userId, strategyName))
        .rejects.toThrow('Database retrieval failed');
    });

    it('should delete a strategy successfully', async () => {
      const userId = 12345;
      const strategyName = 'test-strategy';

      mockDb.deleteStrategy.mockResolvedValue(undefined);

      await expect(strategyService.deleteStrategy(userId, strategyName))
        .resolves.toBeUndefined();
      
      expect(mockDb.deleteStrategy).toHaveBeenCalledWith(userId, strategyName);
    });

    it('should handle strategy deletion errors', async () => {
      const userId = 12345;
      const strategyName = 'test-strategy';
      const error = new Error('Database deletion failed');

      mockDb.deleteStrategy.mockRejectedValue(error);

      await expect(strategyService.deleteStrategy(userId, strategyName))
        .rejects.toThrow('Database deletion failed');
    });
  });

  describe('Strategy Validation', () => {
    it('should check if strategy exists', async () => {
      const userId = 12345;
      const strategyName = 'existing-strategy';
      const mockStrategy: SavedStrategy = {
        id: 1,
        name: strategyName,
        description: 'Existing strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 },
        isDefault: false,
        createdAt: '2024-01-01T00:00:00Z'
      };

      mockDb.getStrategy.mockResolvedValue(mockStrategy);

      const exists = await strategyService.strategyExists(userId, strategyName);

      expect(exists).toBe(true);
      expect(mockDb.getStrategy).toHaveBeenCalledWith(userId, strategyName);
    });

    it('should return false for non-existent strategy', async () => {
      const userId = 12345;
      const strategyName = 'non-existent';

      mockDb.getStrategy.mockResolvedValue(null);

      const exists = await strategyService.strategyExists(userId, strategyName);

      expect(exists).toBe(false);
    });

    it('should handle strategy existence check errors', async () => {
      const userId = 12345;
      const strategyName = 'test-strategy';
      const error = new Error('Database error');

      mockDb.getStrategy.mockRejectedValue(error);

      await expect(strategyService.strategyExists(userId, strategyName))
        .rejects.toThrow('Database error');
    });
  });

  describe('Default Strategy Management', () => {
    it('should get default strategy for user', async () => {
      const userId = 12345;
      const mockStrategies: SavedStrategy[] = [
        {
          id: 1,
          name: 'strategy-1',
          description: 'First strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.2, trailing: 0.3 },
          isDefault: false,
          createdAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          name: 'strategy-2',
          description: 'Default strategy',
          strategy: [{ percent: 1, target: 1.5 }],
          stopLossConfig: { initial: -0.1, trailing: 'none' },
          isDefault: true,
          createdAt: '2024-01-02T00:00:00Z'
        }
      ];

      mockDb.getUserStrategies.mockResolvedValue(mockStrategies);

      const defaultStrategy = await strategyService.getDefaultStrategy(userId);

      expect(defaultStrategy).toEqual(mockStrategies[1]);
      expect(defaultStrategy?.isDefault).toBe(true);
    });

    it('should return null when no default strategy exists', async () => {
      const userId = 12345;
      const mockStrategies: SavedStrategy[] = [
        {
          id: 1,
          name: 'strategy-1',
          description: 'First strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.2, trailing: 0.3 },
          isDefault: false,
          createdAt: '2024-01-01T00:00:00Z'
        }
      ];

      mockDb.getUserStrategies.mockResolvedValue(mockStrategies);

      const defaultStrategy = await strategyService.getDefaultStrategy(userId);

      expect(defaultStrategy).toBeNull();
    });

    it('should return null when user has no strategies', async () => {
      const userId = 12345;

      mockDb.getUserStrategies.mockResolvedValue([]);

      const defaultStrategy = await strategyService.getDefaultStrategy(userId);

      expect(defaultStrategy).toBeNull();
    });

    it('should set a strategy as default', async () => {
      const userId = 12345;
      const strategyName = 'new-default';
      const mockStrategies: SavedStrategy[] = [
        {
          id: 1,
          name: 'old-default',
          description: 'Old default strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.2, trailing: 0.3 },
          isDefault: true,
          createdAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          name: strategyName,
          description: 'New default strategy',
          strategy: [{ percent: 1, target: 1.5 }],
          stopLossConfig: { initial: -0.1, trailing: 'none' },
          isDefault: false,
          createdAt: '2024-01-02T00:00:00Z'
        }
      ];

      mockDb.getUserStrategies.mockResolvedValue(mockStrategies);
      mockDb.getStrategy.mockResolvedValue(mockStrategies[1]);
      mockDb.saveStrategy.mockResolvedValue(2);

      await strategyService.setDefaultStrategy(userId, strategyName);

      // Should unset old default
      expect(mockDb.saveStrategy).toHaveBeenCalledWith({
        userId,
        name: 'old-default',
        description: 'Old default strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 },
        isDefault: false
      });

      // Should set new default
      expect(mockDb.saveStrategy).toHaveBeenCalledWith({
        userId,
        name: strategyName,
        description: 'New default strategy',
        strategy: [{ percent: 1, target: 1.5 }],
        stopLossConfig: { initial: -0.1, trailing: 'none' },
        isDefault: true
      });
    });

    it('should handle setting default strategy when no previous default exists', async () => {
      const userId = 12345;
      const strategyName = 'new-default';
      const mockStrategies: SavedStrategy[] = [
        {
          id: 1,
          name: 'strategy-1',
          description: 'First strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.2, trailing: 0.3 },
          isDefault: false,
          createdAt: '2024-01-01T00:00:00Z'
        }
      ];

      mockDb.getUserStrategies.mockResolvedValue(mockStrategies);
      mockDb.getStrategy.mockResolvedValue(mockStrategies[0]);
      mockDb.saveStrategy.mockResolvedValue(1);

      await strategyService.setDefaultStrategy(userId, strategyName);

      // Should only set new default (no unset calls)
      expect(mockDb.saveStrategy).toHaveBeenCalledTimes(1);
      expect(mockDb.saveStrategy).toHaveBeenCalledWith({
        userId,
        name: 'strategy-1', // The actual strategy name from mockStrategies
        description: 'First strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 },
        isDefault: true
      });
    });

    it('should throw error when setting non-existent strategy as default', async () => {
      const userId = 12345;
      const strategyName = 'non-existent';

      mockDb.getUserStrategies.mockResolvedValue([]);
      mockDb.getStrategy.mockResolvedValue(null);

      await expect(strategyService.setDefaultStrategy(userId, strategyName))
        .rejects.toThrow(`Strategy "${strategyName}" not found`);
    });

    it('should handle errors when setting default strategy', async () => {
      const userId = 12345;
      const strategyName = 'test-strategy';
      const error = new Error('Database error');

      mockDb.getUserStrategies.mockRejectedValue(error);

      await expect(strategyService.setDefaultStrategy(userId, strategyName))
        .rejects.toThrow('Database error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strategy arrays', async () => {
      const userId = 12345;
      const strategyData: StrategyData = {
        name: 'empty-strategy',
        description: 'Strategy with no steps',
        strategy: [],
        stopLossConfig: { initial: -0.1, trailing: 'none' }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
      expect(mockDb.saveStrategy).toHaveBeenCalledWith({
        userId,
        ...strategyData
      });
    });

    it('should handle strategies with single step', async () => {
      const userId = 12345;
      const strategyData: StrategyData = {
        name: 'single-step-strategy',
        description: 'Strategy with one step',
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.5, trailing: 'none' }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
    });

    it('should handle strategies with complex stop loss configurations', async () => {
      const userId = 12345;
      const strategyData: StrategyData = {
        name: 'complex-stop-loss',
        description: 'Strategy with complex stop loss',
        strategy: [{ percent: 1, target: 1.5 }],
        stopLossConfig: { initial: -0.8, trailing: 0.9 }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
    });

    it('should handle strategies with trailing stop loss as none', async () => {
      const userId = 12345;
      const strategyData: StrategyData = {
        name: 'no-trailing-stop',
        description: 'Strategy without trailing stop',
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 'none' }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
    });

    it('should handle very long strategy names', async () => {
      const userId = 12345;
      const longName = 'A'.repeat(1000);
      const strategyData: StrategyData = {
        name: longName,
        description: 'Strategy with very long name',
        strategy: [{ percent: 1, target: 1.5 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
    });

    it('should handle strategies with very long descriptions', async () => {
      const userId = 12345;
      const longDescription = 'B'.repeat(5000);
      const strategyData: StrategyData = {
        name: 'long-description-strategy',
        description: longDescription,
        strategy: [{ percent: 1, target: 1.5 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
    });

    it('should handle strategies with many steps', async () => {
      const userId = 12345;
      const manySteps = Array(50).fill(null).map((_, i) => ({
        percent: 0.02, // 2% each
        target: 1 + (i * 0.1) // 1.0, 1.1, 1.2, etc.
      }));
      
      const strategyData: StrategyData = {
        name: 'many-steps-strategy',
        description: 'Strategy with many steps',
        strategy: manySteps,
        stopLossConfig: { initial: -0.1, trailing: 'none' }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      const result = await strategyService.saveStrategy(userId, strategyData);

      expect(result).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const userId = 12345;
      const strategyData: StrategyData = {
        name: 'test-strategy',
        description: 'Test strategy',
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 }
      };

      const connectionError = new Error('Database connection failed');
      mockDb.saveStrategy.mockRejectedValue(connectionError);

      await expect(strategyService.saveStrategy(userId, strategyData))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle timeout errors', async () => {
      const userId = 12345;
      const timeoutError = new Error('Request timeout');
      mockDb.getUserStrategies.mockRejectedValue(timeoutError);

      await expect(strategyService.getUserStrategies(userId))
        .rejects.toThrow('Request timeout');
    });

    it('should handle invalid user IDs', async () => {
      const invalidUserId = -1;
      const strategyData: StrategyData = {
        name: 'test-strategy',
        description: 'Test strategy',
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 }
      };

      mockDb.saveStrategy.mockResolvedValue(1);

      // Should not throw for invalid user ID (database will handle it)
      const result = await strategyService.saveStrategy(invalidUserId, strategyData);
      expect(result).toBe(1);
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete strategy lifecycle', async () => {
      const userId = 12345;
      const strategyData: StrategyData = {
        name: 'lifecycle-strategy',
        description: 'Strategy for testing complete lifecycle',
        strategy: [{ percent: 1, target: 2 }],
        stopLossConfig: { initial: -0.2, trailing: 0.3 }
      };

      // Save strategy
      mockDb.saveStrategy.mockResolvedValue(1);
      const saveResult = await strategyService.saveStrategy(userId, strategyData);
      expect(saveResult).toBe(1);

      // Check if strategy exists
      const mockStrategy: SavedStrategy = {
        id: 1,
        name: strategyData.name,
        description: strategyData.description,
        strategy: strategyData.strategy,
        stopLossConfig: strategyData.stopLossConfig,
        isDefault: false,
        createdAt: '2024-01-01T00:00:00Z'
      };
      mockDb.getStrategy.mockResolvedValue(mockStrategy);
      const exists = await strategyService.strategyExists(userId, strategyData.name);
      expect(exists).toBe(true);

      // Get strategy
      const retrieved = await strategyService.getStrategy(userId, strategyData.name);
      expect(retrieved).toEqual(mockStrategy);

      // Set as default
      mockDb.getUserStrategies.mockResolvedValue([mockStrategy]);
      mockDb.saveStrategy.mockResolvedValue(1);
      await strategyService.setDefaultStrategy(userId, strategyData.name);

      // Delete strategy
      mockDb.deleteStrategy.mockResolvedValue(undefined);
      await strategyService.deleteStrategy(userId, strategyData.name);
      expect(mockDb.deleteStrategy).toHaveBeenCalledWith(userId, strategyData.name);
    });
  });
});
