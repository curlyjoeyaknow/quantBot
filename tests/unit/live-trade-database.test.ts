/**
 * Live Trade Database Tests
 * ========================
 * Tests for live trade database functions
 */

import * as sqlite3 from 'sqlite3';
import { storeEntryAlert, getEntryAlerts, getLatestPrice } from '../../src/utils/live-trade-database';

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

describe('Live Trade Database', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      run: jest.fn((query, params, callback) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      }),
      get: jest.fn((query, params, callback) => {
        if (callback) {
          process.nextTick(() => callback(null, { price: 1.5, timestamp: Date.now() }));
        }
        return mockDb;
      }),
      all: jest.fn((query, params, callback) => {
        if (callback) {
          process.nextTick(() => callback(null, []));
        }
        return mockDb;
      }),
      close: jest.fn(),
    };

    MockedDatabase.mockImplementation(() => mockDb);
  });

  describe('storeEntryAlert', () => {
    it('should store entry alert', async () => {
      const alert = {
        alertId: 1,
        tokenAddress: '0x123',
        tokenSymbol: 'TEST',
        chain: 'ethereum',
        callerName: 'TestCaller',
        alertPrice: 1.0,
        entryPrice: 1.05,
        entryType: 'initial',
        signal: 'buy',
        priceChange: 5.0,
        timestamp: Date.now(),
      };

      await storeEntryAlert(alert);

      expect(mockDb.run).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      mockDb.run.mockImplementation((query: string, params: any[], callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(new Error('DB error')));
        }
        return mockDb;
      });

      const alert = {
        alertId: 1,
        tokenAddress: '0x123',
        chain: 'ethereum',
        callerName: 'TestCaller',
        alertPrice: 1.0,
        entryPrice: 1.05,
        entryType: 'initial',
        signal: 'buy',
        priceChange: 5.0,
        timestamp: Date.now(),
      };

      await expect(storeEntryAlert(alert)).rejects.toThrow('DB error');
    });
  });

  describe('getEntryAlerts', () => {
    it('should get entry alerts', async () => {
      mockDb.all.mockImplementation((query: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
        if (callback) {
          process.nextTick(() => callback(null, [
            { alert_id: 1, token_address: '0x123', entry_price: 1.05 },
          ]));
        }
        return mockDb;
      });

      const result = await getEntryAlerts('0x123');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.all).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle database errors', async () => {
      mockDb.all.mockImplementation((query: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
        if (callback) {
          process.nextTick(() => callback(new Error('DB error')));
        }
        return mockDb;
      });

      await expect(getEntryAlerts('0x123')).rejects.toThrow('DB error');
    });
  });

  describe('getLatestPrice', () => {
    it('should get latest price', async () => {
      mockDb.get.mockImplementation((query: string, params: any[], callback?: (err: Error | null, row?: any) => void) => {
        if (callback) {
          process.nextTick(() => callback(null, { price: 1.5, timestamp: Date.now() }));
        }
        return mockDb;
      });

      const result = await getLatestPrice('0x123');

      expect(result).toBeDefined();
      expect(result?.price).toBe(1.5);
      expect(mockDb.get).toHaveBeenCalled();
      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should return null when no price found', async () => {
      mockDb.get.mockImplementation((query: string, params: any[], callback?: (err: Error | null, row?: any) => void) => {
        if (callback) {
          process.nextTick(() => callback(null, null));
        }
        return mockDb;
      });

      const result = await getLatestPrice('0x123');

      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      mockDb.get.mockImplementation((query: string, params: any[], callback?: (err: Error | null, row?: any) => void) => {
        if (callback) {
          process.nextTick(() => callback(new Error('DB error')));
        }
        return mockDb;
      });

      await expect(getLatestPrice('0x123')).rejects.toThrow('DB error');
    });
  });
});

