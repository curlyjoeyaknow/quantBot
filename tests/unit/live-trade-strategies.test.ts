/**
 * Live Trade Strategies Tests
 * ===========================
 * Tests for live trade strategy database functions
 */

import * as sqlite3 from 'sqlite3';
import { getEnabledStrategies, isStrategyEnabled } from '../../src/utils/live-trade-strategies';

// Mock sqlite3
jest.mock('sqlite3');
const MockedDatabase = sqlite3.Database as jest.MockedClass<typeof sqlite3.Database>;

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Live Trade Strategies', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      all: jest.fn(),
      get: jest.fn(),
      close: jest.fn(),
    };

    MockedDatabase.mockImplementation(() => mockDb);
  });

  describe('getEnabledStrategies', () => {
    it('should return enabled strategies', async () => {
      const promisifyAll = jest.fn().mockResolvedValue([
        { id: 'initial_entry' },
        { id: 'trailing_entry' },
      ]);

      mockDb.all = promisifyAll;

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('initial_entry')).toBe(true);
      expect(result.has('trailing_entry')).toBe(true);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should return default strategies on error', async () => {
      const promisifyAll = jest.fn().mockRejectedValue(new Error('Table does not exist'));

      mockDb.all = promisifyAll;

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.has('initial_entry')).toBe(true);
      expect(result.has('trailing_entry')).toBe(true);
      expect(result.has('ichimoku_tenkan_kijun')).toBe(true);
    });

    it('should return empty set when no strategies enabled', async () => {
      const promisifyAll = jest.fn().mockResolvedValue([]);

      mockDb.all = promisifyAll;

      const result = await getEnabledStrategies();

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });
  });

  describe('isStrategyEnabled', () => {
    it('should return true for enabled strategy', async () => {
      const promisifyGet = jest.fn().mockResolvedValue({ enabled: 1 });

      mockDb.get = promisifyGet;

      const result = await isStrategyEnabled('initial_entry');

      expect(result).toBe(true);
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should return false for disabled strategy', async () => {
      const promisifyGet = jest.fn().mockResolvedValue({ enabled: 0 });

      mockDb.get = promisifyGet;

      const result = await isStrategyEnabled('disabled_strategy');

      expect(result).toBe(false);
    });

    it('should return false when strategy not found', async () => {
      const promisifyGet = jest.fn().mockResolvedValue(null);

      mockDb.get = promisifyGet;

      const result = await isStrategyEnabled('nonexistent');

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      const promisifyGet = jest.fn().mockRejectedValue(new Error('DB error'));

      mockDb.get = promisifyGet;

      const result = await isStrategyEnabled('test');

      expect(result).toBe(false);
    });
  });
});

