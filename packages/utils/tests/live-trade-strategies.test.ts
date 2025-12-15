import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEnabledStrategies, isStrategyEnabled } from '../src/live-trade-strategies';
import * as sqlite3 from 'sqlite3';
import { promisify } from 'util';

vi.mock('sqlite3', () => ({
  Database: vi.fn(),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => fn),
}));

describe('Live Trade Strategies', () => {
  let mockDb: any;
  let mockAll: any;
  let mockGet: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll = vi.fn();
    mockGet = vi.fn();
    mockDb = {
      all: mockAll,
      get: mockGet,
      close: vi.fn(),
    };
    vi.mocked(sqlite3.Database).mockImplementation(() => mockDb as any);
  });

  describe('getEnabledStrategies', () => {
    it('should return enabled strategies', async () => {
      mockAll.mockResolvedValue([{ id: 'initial_entry' }, { id: 'trailing_entry' }]);

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('initial_entry')).toBe(true);
      expect(result.has('trailing_entry')).toBe(true);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should return default strategies on error', async () => {
      mockAll.mockRejectedValue(new Error('Database error'));

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('initial_entry')).toBe(true);
      expect(result.has('trailing_entry')).toBe(true);
      expect(result.has('ichimoku_tenkan_kijun')).toBe(true);
    });

    it('should return empty set if no strategies enabled', async () => {
      mockAll.mockResolvedValue([]);

      const result = await getEnabledStrategies();

      expect(result.size).toBe(0);
    });
  });

  describe('isStrategyEnabled', () => {
    it('should return true if strategy is enabled', async () => {
      mockGet.mockResolvedValue({ enabled: 1 });

      const result = await isStrategyEnabled('initial_entry');

      expect(result).toBe(true);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should return false if strategy is disabled', async () => {
      mockGet.mockResolvedValue({ enabled: 0 });

      const result = await isStrategyEnabled('test_strategy');

      expect(result).toBe(false);
    });

    it('should return true by default if strategy not found', async () => {
      mockGet.mockResolvedValue(null);

      const result = await isStrategyEnabled('unknown_strategy');

      expect(result).toBe(true);
    });

    it('should return true on error (backward compatibility)', async () => {
      mockGet.mockRejectedValue(new Error('Database error'));

      const result = await isStrategyEnabled('test_strategy');

      expect(result).toBe(true);
    });
  });
});
