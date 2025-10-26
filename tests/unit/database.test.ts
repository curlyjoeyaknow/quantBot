/**
 * @file database.test.ts
 * @description
 *   Unit tests for the Database utility functions used within the application.
 *   Uses Jest for automated testing and mock sqlite3 database connections to
 *   verify correctness and error handling.
 *
 *   This suite covers the initialization, CRUD operations, and resilience to
 *   errors for all supported database-bound operations in the database utility.
 */
import { Database } from 'sqlite3';
import { DateTime } from 'luxon';
import * as db from '../../src/utils/database';

// -------------------------[ Mock Initialization Section ]--------------------------

/**
 * Mocks the sqlite3 Database class using Jest to prevent real database interactions
 * during unit testing. Every invocation of `new Database()` within this file will 
 * return the configured mock database object.
 */
jest.mock('sqlite3');
const MockedDatabase = Database as jest.MockedClass<typeof Database>;

// ------------------------[ Global Test Suite Definition ]-------------------------

describe('Database Utilities', () => {
  /**
   * mockDb: A Jest-mocked sqlite3.Database instance. All database method calls
   * within these tests will route to this mock, allowing for assertion, error injection,
   * and behavioral overrides.
   */
  let mockDb: jest.Mocked<Database>;

  /**
   * Helper function to create a mock callback that simulates async behavior
   */
  const createAsyncCallback = (callback: Function, error?: any, result?: any) => {
    return () => {
      if (callback) {
        setTimeout(() => {
          if (error) {
            callback.call(mockDb, error);
          } else {
            callback.call(mockDb, null, result);
          }
        }, 0);
      }
    };
  };

  /**
   * Resets mocks and re-injects a new mocked Database before each test for isolation.
   */
  beforeEach(() => {
    jest.clearAllMocks();
    
    const mockStatement = {
      bind: jest.fn(),
      reset: jest.fn(),
      finalize: jest.fn(),
    };
    
    mockDb = {
      run: jest.fn(),
      get: jest.fn(),
      all: jest.fn(),
      prepare: jest.fn().mockReturnValue(mockStatement),
      close: jest.fn(),
    } as any;

    MockedDatabase.mockImplementation(() => mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------[ Database Initialization Tests ]-------------------------

  describe('initDatabase', () => {
    it('should initialize database successfully', async () => {
      mockDb.run.mockImplementation((sql, callback) => {
        createAsyncCallback(callback)();
        return mockDb;
      });

      await expect(db.initDatabase()).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle database initialization errors', async () => {
      const error = new Error('Database initialization failed');
      mockDb.run.mockImplementation((sql, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.initDatabase()).rejects.toThrow('Database initialization failed');
    });
  });

  // -------------------------[ Simulation Run Management Tests ]-------------------------

  describe('saveSimulationRun', () => {
    const mockSimulationData = {
      userId: 12345,
      mint: 'test-mint',
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      startTime: DateTime.utc(),
      endTime: DateTime.utc(),
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 },
      finalPnl: 1.5,
      totalCandles: 100,
      events: []
    };

    it('should save simulation run successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, null, { lastID: 1 })();
        return mockDb;
      });

      const result = await db.saveSimulationRun(mockSimulationData);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle save errors', async () => {
      const error = new Error('Save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.saveSimulationRun(mockSimulationData)).rejects.toThrow('Save failed');
    });
  });

  describe('getUserSimulationRuns', () => {
    it('should retrieve user simulation runs', async () => {
      const mockRuns = [
        {
          id: 1,
          userId: 12345,
          mint: 'test-mint',
          chain: 'solana',
          tokenName: 'Test Token',
          tokenSymbol: 'TEST',
          startTime: DateTime.utc().toISO(),
          endTime: DateTime.utc().toISO(),
          strategy: JSON.stringify([{ percent: 0.5, target: 2 }]),
          stopLossConfig: JSON.stringify({ initial: -0.3, trailing: 0.5 }),
          finalPnl: 1.5,
          totalCandles: 100,
          createdAt: DateTime.utc().toISO()
        }
      ];

      mockDb.all.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, null, mockRuns)();
        return mockDb;
      });

      const result = await db.getUserSimulationRuns(12345, 10);
      expect(result).toEqual(mockRuns);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should handle retrieval errors', async () => {
      const error = new Error('Retrieval failed');
      mockDb.all.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.getUserSimulationRuns(12345, 10)).rejects.toThrow('Retrieval failed');
    });
  });

  // -------------------------[ Strategy Management Tests ]-------------------------

  describe('saveStrategy', () => {
    const mockStrategyData = {
      userId: 12345,
      name: 'test-strategy',
      description: 'Test strategy',
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 }
    };

    it('should save strategy successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, null, { lastID: 1 })();
        return mockDb;
      });

      const result = await db.saveStrategy(mockStrategyData);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle strategy save errors', async () => {
      const error = new Error('Strategy save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.saveStrategy(mockStrategyData)).rejects.toThrow('Strategy save failed');
    });
  });

  describe('getUserStrategies', () => {
    it('should retrieve user strategies', async () => {
      const mockStrategies = [
        {
          id: 1,
          userId: 12345,
          name: 'test-strategy',
          description: 'Test strategy',
          strategy: JSON.stringify([{ percent: 0.5, target: 2 }]),
          stopLossConfig: JSON.stringify({ initial: -0.3, trailing: 0.5 }),
          isDefault: false,
          createdAt: DateTime.utc().toISO()
        }
      ];

      mockDb.all.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, null, mockStrategies)();
        return mockDb;
      });

      const result = await db.getUserStrategies(12345);
      expect(result).toEqual(mockStrategies);
      expect(mockDb.all).toHaveBeenCalled();
    });

    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.all.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
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
        name: 'test-strategy',
        description: 'Test strategy',
        strategy: JSON.stringify([{ percent: 0.5, target: 2 }]),
        stopLossConfig: JSON.stringify({ initial: -0.3, trailing: 0.5 }),
        isDefault: false,
        createdAt: DateTime.utc().toISO()
      };

      mockDb.get.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, null, mockStrategy)();
        return mockDb;
      });

      const result = await db.getStrategy(12345, 'test-strategy');
      expect(result).toEqual(mockStrategy);
      expect(mockDb.get).toHaveBeenCalled();
    });

    it('should return null for non-existent strategy', async () => {
      mockDb.get.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, null, null)();
        return mockDb;
      });

      const result = await db.getStrategy(12345, 'non-existent');
      expect(result).toBeNull();
    });

    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.get.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.getStrategy(12345, 'test-strategy')).rejects.toThrow('Strategy retrieval failed');
    });
  });

  describe('deleteStrategy', () => {
    it('should delete strategy successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback)();
        return mockDb;
      });

      await expect(db.deleteStrategy(12345, 'test-strategy')).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle strategy deletion errors', async () => {
      const error = new Error('Strategy deletion failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.deleteStrategy(12345, 'test-strategy')).rejects.toThrow('Strategy deletion failed');
    });
  });

  // -------------------------[ CA Drop Management Tests ]-------------------------

  describe('saveCADrop', () => {
    const mockCADrop = {
      userId: 12345,
      chatId: 12345,
      mint: 'test-mint',
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
        createAsyncCallback(callback, null, { lastID: 1 })();
        return mockDb;
      });

      const result = await db.saveCADrop(mockCADrop);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('should handle CA drop save errors', async () => {
      const error = new Error('CA drop save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        createAsyncCallback(callback, error)();
        return mockDb;
      });

      await expect(db.saveCADrop(mockCADrop)).rejects.toThrow('CA drop save failed');
    });
  });

});