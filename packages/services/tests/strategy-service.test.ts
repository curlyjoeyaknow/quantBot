import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrategyService } from '../../src/services/StrategyService';
import * as db from '../../src/utils/database';

// Mock database
vi.mock('../../src/utils/database', () => ({
  saveStrategy: vi.fn(),
  getUserStrategies: vi.fn(),
  getStrategy: vi.fn(),
  deleteStrategy: vi.fn(),
}));

describe('strategy-service', () => {
  let service: StrategyService;

  beforeEach(() => {
    service = new StrategyService();
    vi.clearAllMocks();
  });

  describe('saveStrategy', () => {
    it('should save strategy', async () => {
      const strategyData = {
        name: 'Test Strategy',
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
      };

      vi.mocked(db.saveStrategy).mockResolvedValue(1);

      const id = await service.saveStrategy(123, strategyData);

      expect(id).toBe(1);
      expect(db.saveStrategy).toHaveBeenCalledWith({
        userId: 123,
        ...strategyData,
      });
    });
  });

  describe('getUserStrategies', () => {
    it('should return user strategies', async () => {
      const mockStrategies = [
        {
          id: 1,
          name: 'Strategy 1',
          strategy: [{ target: 2, percent: 1.0 }],
          stopLossConfig: { initial: -0.2 },
          isDefault: false,
          createdAt: new Date(),
        },
      ];

      vi.mocked(db.getUserStrategies).mockResolvedValue(mockStrategies as any);

      const strategies = await service.getUserStrategies(123);

      expect(strategies).toEqual(mockStrategies);
      expect(db.getUserStrategies).toHaveBeenCalledWith(123);
    });
  });

  describe('getStrategy', () => {
    it('should return strategy by name', async () => {
      const mockStrategy = {
        id: 1,
        name: 'Test Strategy',
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        isDefault: false,
        createdAt: new Date(),
      };

      vi.mocked(db.getStrategy).mockResolvedValue(mockStrategy as any);

      const strategy = await service.getStrategy(123, 'Test Strategy');

      expect(strategy).toEqual(mockStrategy);
      expect(db.getStrategy).toHaveBeenCalledWith(123, 'Test Strategy');
    });

    it('should return null when strategy not found', async () => {
      vi.mocked(db.getStrategy).mockResolvedValue(null);

      const strategy = await service.getStrategy(123, 'Non-existent');

      expect(strategy).toBeNull();
    });
  });

  describe('deleteStrategy', () => {
    it('should delete strategy', async () => {
      vi.mocked(db.deleteStrategy).mockResolvedValue(undefined);

      await service.deleteStrategy(123, 'Test Strategy');

      expect(db.deleteStrategy).toHaveBeenCalledWith(123, 'Test Strategy');
    });
  });

  describe('strategyExists', () => {
    it('should return true when strategy exists', async () => {
      const mockStrategy = {
        id: 1,
        name: 'Test Strategy',
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        isDefault: false,
        createdAt: new Date(),
      };

      vi.mocked(db.getStrategy).mockResolvedValue(mockStrategy as any);

      const exists = await service.strategyExists(123, 'Test Strategy');

      expect(exists).toBe(true);
    });

    it('should return false when strategy does not exist', async () => {
      vi.mocked(db.getStrategy).mockResolvedValue(null);

      const exists = await service.strategyExists(123, 'Non-existent');

      expect(exists).toBe(false);
    });
  });

  describe('getDefaultStrategy', () => {
    it('should return default strategy', async () => {
      const mockStrategies = [
        {
          id: 1,
          name: 'Default Strategy',
          strategy: [{ target: 2, percent: 1.0 }],
          stopLossConfig: { initial: -0.2 },
          isDefault: true,
          createdAt: new Date(),
        },
        {
          id: 2,
          name: 'Other Strategy',
          strategy: [{ target: 3, percent: 1.0 }],
          stopLossConfig: { initial: -0.3 },
          isDefault: false,
          createdAt: new Date(),
        },
      ];

      vi.mocked(db.getUserStrategies).mockResolvedValue(mockStrategies as any);

      const defaultStrategy = await service.getDefaultStrategy(123);

      expect(defaultStrategy?.name).toBe('Default Strategy');
    });

    it('should return null when no default strategy', async () => {
      const mockStrategies = [
        {
          id: 1,
          name: 'Strategy 1',
          strategy: [{ target: 2, percent: 1.0 }],
          stopLossConfig: { initial: -0.2 },
          isDefault: false,
          createdAt: new Date(),
        },
      ];

      vi.mocked(db.getUserStrategies).mockResolvedValue(mockStrategies as any);

      const defaultStrategy = await service.getDefaultStrategy(123);

      expect(defaultStrategy).toBeNull();
    });
  });

  describe('setDefaultStrategy', () => {
    it('should set strategy as default', async () => {
      const existingStrategy = {
        id: 1,
        name: 'Test Strategy',
        description: 'Test',
        strategy: [{ target: 2, percent: 1.0 }],
        stopLossConfig: { initial: -0.2 },
        isDefault: false,
        createdAt: new Date(),
      };

      const existingStrategies = [
        {
          id: 2,
          name: 'Old Default',
          strategy: [{ target: 3, percent: 1.0 }],
          stopLossConfig: { initial: -0.3 },
          isDefault: true,
          createdAt: new Date(),
        },
        existingStrategy,
      ];

      vi.mocked(db.getUserStrategies).mockResolvedValue(existingStrategies as any);
      vi.mocked(db.getStrategy).mockResolvedValue(existingStrategy as any);
      vi.mocked(db.saveStrategy).mockResolvedValue(1);

      await service.setDefaultStrategy(123, 'Test Strategy');

      // Should unset old default and set new default
      expect(db.saveStrategy).toHaveBeenCalledTimes(2);
    });

    it('should throw error when strategy not found', async () => {
      vi.mocked(db.getStrategy).mockResolvedValue(null);

      await expect(service.setDefaultStrategy(123, 'Non-existent')).rejects.toThrow(
        'Strategy "Non-existent" not found',
      );
    });
  });
});


