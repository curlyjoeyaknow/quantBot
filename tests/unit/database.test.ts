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
      close: jest.fn(),
      exec: jest.fn(),
      prepare: jest.fn(),
    } as any;
    
    MockedDatabase.mockImplementation(() => mockDb);
  });

  // ----------------------[ Test Group: Database Initialization ]----------------------

  describe('initDatabase', () => {
    /**
     * Test: Successful database initialization scenario. Ensures db.initDatabase()
     * resolves and the internal run() is called as expected.
     */
    it('should initialize database successfully', async () => {
      const mockStatement = {
        bind: jest.fn(),
        reset: jest.fn(),
        finalize: jest.fn(),
      };
      
      mockDb.exec.mockImplementation((sql, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockStatement as any, null);
        }
        return mockDb;
      });

      await expect(db.initDatabase()).resolves.toBeUndefined();
      expect(mockDb.exec).toHaveBeenCalled();
    });

    /**
     * Test: Simulates a failure during initialization and checks
     * error propagation.
     */
    it('should handle database initialization errors', async () => {
      const error = new Error('Database initialization failed');
      const mockStatement = {
        bind: jest.fn(),
        reset: jest.fn(),
        finalize: jest.fn(),
      };
      
      mockDb.exec.mockImplementation((sql, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockStatement as any, error);
        }
        return mockDb;
      });

      await expect(db.initDatabase()).rejects.toThrow('Database initialization failed');
    });
  });

  // --------------------[ Test Group: Simulation Run Persistence ]----------------------

  describe('saveSimulationRun', () => {
    /**
     * A mock simulation run object to pass into the database layer.
     */
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

    /**
     * Test: Checks persistence and callback invocation for simulation runs.
     */
    it('should save simulation run successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.saveSimulationRun(mockSimulationRun)).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    /**
     * Test: Expects saveSimulationRun to properly propagate errors from run().
     */
    it('should handle save errors', async () => {
      const error = new Error('Save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error);
        }
        return mockDb;
      });

      await expect(db.saveSimulationRun(mockSimulationRun)).rejects.toThrow('Save failed');
    });
  });

  // ---------------[ Test Group: Retrieve Simulation Runs for a User ]------------------

  describe('getUserSimulationRuns', () => {
    /**
     * Test: Simulates correct retrieval of user simulation runs.
     */
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
        if (typeof callback === 'function') {
          callback.call(mockDb, null, mockRuns);
        }
        return mockDb;
      });

      const result = await db.getUserSimulationRuns(12345, 10);
      expect(result).toEqual(mockRuns);
      expect(mockDb.all).toHaveBeenCalled();
    });

    /**
     * Test: Simulates a retrieval error scenario.
     */
    it('should handle retrieval errors', async () => {
      const error = new Error('Retrieval failed');
      mockDb.all.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error, null);
        }
        return mockDb;
      });

      await expect(db.getUserSimulationRuns(12345, 10)).rejects.toThrow('Retrieval failed');
    });
  });

  // -------------------[ Test Group: User-Defined Strategies CRUD ]---------------------

  describe('saveStrategy', () => {
    /**
     * Mock object representing a user-defined trading strategy.
     */
    const mockStrategy = {
      userId: 12345,
      name: 'Test Strategy',
      description: 'A test strategy',
      strategy: [{ percent: 0.5, target: 2 }],
      stopLossConfig: { initial: -0.3, trailing: 0.5 }
    };

    /**
     * Test: Verifies successful strategy saving behavior.
     */
    it('should save strategy successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.saveStrategy(mockStrategy)).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    /**
     * Test: Verifies error handling during strategy persistence.
     */
    it('should handle strategy save errors', async () => {
      const error = new Error('Strategy save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error);
        }
        return mockDb;
      });

      await expect(db.saveStrategy(mockStrategy)).rejects.toThrow('Strategy save failed');
    });
  });

  describe('getUserStrategies', () => {
    /**
     * Test: Checks retrieval for all user strategies.
     */
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
        if (typeof callback === 'function') {
          callback.call(mockDb, null, mockStrategies);
        }
        return mockDb;
      });

      const result = await db.getUserStrategies(12345);
      expect(result).toEqual(mockStrategies);
      expect(mockDb.all).toHaveBeenCalled();
    });

    /**
     * Test: Ensures getUserStrategies properly handles and forwards retrieval errors.
     */
    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.all.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error, null);
        }
        return mockDb;
      });

      await expect(db.getUserStrategies(12345)).rejects.toThrow('Strategy retrieval failed');
    });
  });

  describe('getStrategy', () => {
    /**
     * Test: Retrieves a specific named strategy for a user.
     */
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
        if (typeof callback === 'function') {
          callback.call(mockDb, null, mockStrategy);
        }
        return mockDb;
      });

      const result = await db.getStrategy(12345, 'Test Strategy');
      expect(result).toEqual(mockStrategy);
      expect(mockDb.get).toHaveBeenCalled();
    });

    /**
     * Test: Verifies behavior when requested strategy is not found; should return null.
     */
    it('should return null for non-existent strategy', async () => {
      mockDb.get.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, null);
        return mockDb;
      });

      const result = await db.getStrategy(12345, 'Non-existent Strategy');
      expect(result).toBeNull();
    });

    /**
     * Test: Ensures error propagation on underlying get() failure.
     */
    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.get.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error, null);
        }
        return mockDb;
      });

      await expect(db.getStrategy(12345, 'Test Strategy')).rejects.toThrow('Strategy retrieval failed');
    });
  });

  describe('deleteStrategy', () => {
    /**
     * Test: Confirms deletion of a named strategy by user.
     */
    it('should delete strategy successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null);
        return mockDb;
      });

      await expect(db.deleteStrategy(12345, 'Test Strategy')).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    });

    /**
     * Test: Checks error handling in the deleteStrategy scenario.
     */
    it('should handle strategy deletion errors', async () => {
      const error = new Error('Strategy deletion failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error);
        }
        return mockDb;
      });

      await expect(db.deleteStrategy(12345, 'Test Strategy')).rejects.toThrow('Strategy deletion failed');
    });
  });

  // ------------------[ Test Group: CA Drop Record Persistence ]-----------------------

  describe('saveCADrop', () => {
    /**
     * A mock CA drop object representing a call-to-action event for a user.
     */
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

    /**
     * Test: Verifies correct assignment of last inserted ID on CA drop save.
     */
    it('should save CA drop successfully', async () => {
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (callback) callback.call(mockDb, null, { lastID: 1 });
        return mockDb;
      });

      const result = await db.saveCADrop(mockCADrop);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    });

    /**
     * Test: Ensures errors on CA drop save propagate as expected.
     */
    it('should handle CA drop save errors', async () => {
      const error = new Error('CA drop save failed');
      mockDb.run.mockImplementation((sql, params, callback) => {
        if (typeof callback === 'function') {
          callback.call(mockDb, error, null);
        }
        return mockDb;
      });

      await expect(db.saveCADrop(mockCADrop)).rejects.toThrow('CA drop save failed');
    });
  });

});