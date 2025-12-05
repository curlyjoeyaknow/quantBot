import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEnabledStrategies, isStrategyEnabled } from '../../src/utils/live-trade-strategies';

// Mock sqlite3
vi.mock('sqlite3', () => {
  const mockDb = {
    all: vi.fn(),
    get: vi.fn(),
    close: vi.fn(),
  };

  return {
    Database: vi.fn().mockImplementation(() => mockDb),
  };
});

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('live-trade-strategies-extended', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEnabledStrategies', () => {
    it('should return enabled strategies', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockAll = vi.fn().mockResolvedValue([
        { id: 'strategy1' },
        { id: 'strategy2' },
      ]);
      mockDb.all = mockAll;

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('strategy1')).toBe(true);
      expect(result.has('strategy2')).toBe(true);
    });

    it('should return default strategies on error', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockAll = vi.fn().mockRejectedValue(new Error('Database error'));
      mockDb.all = mockAll;

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('initial_entry')).toBe(true);
      expect(result.has('trailing_entry')).toBe(true);
      expect(result.has('ichimoku_tenkan_kijun')).toBe(true);
    });

    it('should return empty set when no strategies enabled', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockAll = vi.fn().mockResolvedValue([]);
      mockDb.all = mockAll;

      const result = await getEnabledStrategies();

      expect(result.size).toBe(0);
    });
  });

  describe('isStrategyEnabled', () => {
    it('should return true for enabled strategy', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockGet = vi.fn().mockResolvedValue({ enabled: 1 });
      mockDb.get = mockGet;

      const result = await isStrategyEnabled('strategy1');

      expect(result).toBe(true);
    });

    it('should return false for disabled strategy', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockGet = vi.fn().mockResolvedValue({ enabled: 0 });
      mockDb.get = mockGet;

      const result = await isStrategyEnabled('strategy1');

      expect(result).toBe(false);
    });

    it('should return true when strategy not found (default)', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockGet = vi.fn().mockResolvedValue(null);
      mockDb.get = mockGet;

      const result = await isStrategyEnabled('unknown');

      expect(result).toBe(true);
    });

    it('should return true on database error (default)', async () => {
      const { Database } = await import('sqlite3');
      const mockDb = new (Database as any)();
      
      const mockGet = vi.fn().mockRejectedValue(new Error('Database error'));
      mockDb.get = mockGet;

      const result = await isStrategyEnabled('strategy1');

      expect(result).toBe(true);
    });
  });
});

