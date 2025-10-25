import { Database } from 'sqlite3';
import { DateTime } from 'luxon';
import * as db from '../../src/utils/database';

// Mock sqlite3
jest.mock('sqlite3');
const MockedDatabase = Database as jest.MockedClass<typeof Database>;

describe('Database Utilities', () => {
  let mockDb: jest.Mocked<Database>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
      close: jest.fn(),
    } as any;
    
    MockedDatabase.mockImplementation(() => mockDb);
  });

  describe('initDatabase', () => {
    it('should initialize database successfully', async () => {
      mockDb.run.mockImplementation((sql, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.initDatabase()).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle database initialization errors', async () => {
      const error = new Error('Database initialization failed');
      mockDb.run.mockImplementation((sql, callback) => {
        if (callback) callback.call(mockDb, error);
        return mockDb;
      });

      await expect(db.initDatabase()).rejects.toThrow('Database initialization failed');
    });
  });

  describe('saveSimulationRun', () => {
    const mockSimulationRun = {
      userId: 12345,
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
      startTime: DateTime.fromISO('2024-01-01T00:00:00Z'),
      endTime: DateTime.fromISO('2024-01-02T00:00:00Z'),
      finalPnl: 1.5,
      totalCandles: 100,
      events: []
    };

    it('should save simulation run successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.saveSimulationRun(mockSimulationRun)).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle save errors', async () => {
      const error = new Error('Save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error);
        return mockDb;
      });

      await expect(db.saveSimulationRun(mockSimulationRun)).rejects.toThrow('Save failed');
    });
  });

  describe('getUserSimulationRuns', () => {
    it('should retrieve user simulation runs', async () => {
      const mockRuns = [
        {
          id: 1,
          userId: 12345,
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          tokenName: 'Test Token',
          tokenSymbol: 'TEST',
          finalPnl: 1.5,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          startTime: new Date('2024-01-01T00:00:00Z'),
          endTime: new Date('2024-01-02T00:00:00Z')
        }
      ];

      mockDb.all.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, mockRuns);
        return mockDb;
      });

      const result = await db.getUserSimulationRuns(12345, 10);
      expect(result).toEqual(mockRuns);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should handle retrieval errors', async () => {
      const error = new Error('Retrieval failed');
      mockDb.all.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error, null);
        return mockDb;
      });

      await expect(db.getUserSimulationRuns(12345, 10)).rejects.toThrow('Retrieval failed');
    });
  });

  describe('saveStrategy', () => {
    const mockStrategy = {
      userId: 12345,
      name: 'Test Strategy',
      description: 'A test strategy',
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 }
    };

    it('should save strategy successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.saveStrategy(mockStrategy)).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle strategy save errors', async () => {
      const error = new Error('Strategy save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error);
        return mockDb;
      });

      await expect(db.saveStrategy(mockStrategy)).rejects.toThrow('Strategy save failed');
    });
  });

  describe('getUserStrategies', () => {
    it('should retrieve user strategies', async () => {
      const mockStrategies = [
        {
          id: 1,
          userId: 12345,
          name: 'Test Strategy',
          description: 'A test strategy',
          strategy: [{ percent: 0.5, target: 2 }],
          stopLossConfig: { initial: -0.3, trailing: 0.5 },
          isDefault: false
        }
      ];

      mockDb.all.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, mockStrategies);
        return mockDb;
      });

      const result = await db.getUserStrategies(12345);
      expect(result).toEqual(mockStrategies);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.all.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error, null);
        return mockDb;
      });

      await expect(db.getUserStrategies(12345)).rejects.toThrow('Strategy retrieval failed');
    });
  });

  describe('getStrategy', () => {
    it('should retrieve specific strategy', async () => {
      const mockStrategy = {
        id: 1,
        userId: 12345,
        name: 'Test Strategy',
        description: 'A test strategy',
        strategy: [{ percent: 0.5, target: 2 }],
        stopLossConfig: { initial: -0.3, trailing: 0.5 },
        isDefault: false
      };

      mockDb.get.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, mockStrategy);
        return mockDb;
      });

      const result = await db.getStrategy(12345, 'Test Strategy');
      expect(result).toEqual(mockStrategy);
      expect(mockDb.get).toHaveBeenCalled();
    });

    it('should return null for non-existent strategy', async () => {
      mockDb.get.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, null);
        return mockDb;
      });

      const result = await db.getStrategy(12345, 'Non-existent Strategy');
      expect(result).toBeNull();
    });

    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.get.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error, null);
        return mockDb;
      });

      await expect(db.getStrategy(12345, 'Test Strategy')).rejects.toThrow('Strategy retrieval failed');
    });
  });

  describe('deleteStrategy', () => {
    it('should delete strategy successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.deleteStrategy(12345, 'Test Strategy')).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle strategy deletion errors', async () => {
      const error = new Error('Strategy deletion failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error);
        return mockDb;
      });

      await expect(db.deleteStrategy(12345, 'Test Strategy')).rejects.toThrow('Strategy deletion failed');
    });
  });

  describe('saveCADrop', () => {
    const mockCADrop = {
      userId: 12345,
      chatId: 67890,
      mint: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      callPrice: 1.0,
      callMarketcap: 1000000,
      callTimestamp: 1704067200,
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 }
    };

    it('should save CA drop successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, { lastID: 1 });
        return mockDb;
      });

      const result = await db.saveCADrop(mockCADrop);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle CA drop save errors', async () => {
      const error = new Error('CA drop save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, error, null);
        return mockDb;
      });

      await expect(db.saveCADrop(mockCADrop)).rejects.toThrow('CA drop save failed');
    });
  });
});