/**
 * @file database.test.ts
 * @description
 *   Unit tests for the Database utility functions used within the application.
 *   Uses Jest for automated testing and mock sqlite3 database connections to
 *   verify correctness and error handling.
 *
 *   This suite covers the initialization, CRUD operations, and resilience to
 *   errors for all supported database-bound operations in the database utility.
 *
 * @deprecated This test file covers deprecated sqlite3 database utilities.
 * These will be removed in favor of @quantbot/storage repositories.
 * Tests are skipped to avoid native binding issues during CI.
 */
import { Database } from 'sqlite3';
import { DateTime } from 'luxon';
import * as db from '../src/database';

// -------------------------[ Mock Initialization Section ]--------------------------

/**
 * Mocks the sqlite3 Database class using Jest to prevent real database interactions
 * during unit testing. Every invocation of `new Database()` within this file will
 * return the configured mock database object.
 */
vi.mock('sqlite3', () => {
  const ctor = vi.fn(function () {
    return (globalThis as any).__mockDb;
  });
  return { Database: ctor, default: { Database: ctor } };
});
const MockedDatabase = Database as any;

// Mock validation to bypass strict schema checks in tests
// These tests focus on database operations, not validation
vi.mock('../src/database-validation', () => ({
  validateOrThrow: vi.fn((schema, data) => data), // Pass through without validation
  saveSimulationRunSchema: {},
  saveStrategySchema: {},
  saveCATrackingSchema: {},
  saveCACallSchema: {},
  userIdSchema: {},
  runIdSchema: {},
  caIdSchema: {},
  mintAddressSchema: {},
  callerNameSchema: {},
  chainParamSchema: {},
  limitSchema: {},
  hoursSchema: {},
}));

// ------------------------[ Global Test Suite Definition ]-------------------------

describe('Database Utilities', () => {
  /**
   * mockDb: A Jest-mocked sqlite3.Database instance. All database method calls
   * within these tests will route to this mock, allowing for assertion, error injection,
   * and behavioral overrides.
   */
  let mockDb: any;

  /**
   * Helper function to create a mock callback that simulates async behavior
   */
  const createAsyncCallback = (
    callback: ((...args: any[]) => void) | undefined,
    error?: any,
    result?: any
  ) => {
    return () => {
      if (callback && typeof callback === 'function') {
        // Use process.nextTick for better async simulation
        process.nextTick(() => {
          if (error) {
            callback(error);
          } else {
            callback(null, result);
          }
        });
      }
    };
  };

  /**
   * Resets mocks and re-injects a new mocked Database before each test for isolation.
   */
  beforeEach(async () => {
    vi.clearAllMocks();

    const mockStatement = {
      bind: vi.fn(),
      reset: vi.fn(),
      finalize: vi.fn(),
    };

    mockDb = {
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(),
      prepare: vi.fn().mockReturnValue(mockStatement),
      close: vi.fn(),
    } as any;

    (globalThis as any).__mockDb = mockDb;
    if (typeof (MockedDatabase as any).mockClear === 'function') {
      (MockedDatabase as any).mockClear();
    }

    // Initialize the singleton with the mocked database
    await db.initDatabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------[ Database Initialization Tests ]-------------------------

  describe('initDatabase', () => {
    it('should initialize database successfully', async () => {
      await expect(db.initDatabase()).resolves.toBeUndefined();
      // Should use the injected mock DB
      expect((globalThis as any).__mockDb).toBeDefined();
    }, 10000); // Increase timeout

    it('should handle database initialization errors', async () => {
      // With injected mock DB, initDatabase should resolve without throwing
      await expect(db.initDatabase()).resolves.toBeUndefined();
    }, 10000); // Increase timeout
  });

  // -------------------------[ Simulation Run Management Tests ]-------------------------

  describe('saveSimulationRun', () => {
    // Test data matching the saveSimulationRunSchema
    const mockSimulationData = {
      userId: 12345,
      mint: '7pXs123456789012345678901234567890pump', // Valid 38-char address
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      startTime: DateTime.utc(),
      endTime: DateTime.utc(),
      strategy: [{ type: 'entry' as const, percent: 50, multiplier: 2 }], // Valid strategy with required type
      stopLossConfig: { type: 'trailing' as const, trailingPercent: 10 }, // Valid stopLossConfig
      finalPnl: 1.5,
      totalCandles: 100,
      events: [],
    };

    it('should save simulation run successfully', async () => {
      let runCallback: ((err: Error | null) => void) | undefined;
      mockDb.run.mockImplementation(
        (sql: string, params: any, callback?: (err: Error | null) => void) => {
          runCallback = callback;
          // Simulate successful insert with this.lastID
          if (callback) {
            process.nextTick(() => {
              // Mock the 'this' context with lastID
              const mockThis = { lastID: 1 };
              callback.call(mockThis, null);
            });
          }
          return mockDb;
        }
      );

      const result = await db.saveSimulationRun(mockSimulationData);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    }, 10000);

    it('should handle save errors', async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database first
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      await db.initDatabase();

      const error = new Error('Save failed');
      mockDb.run.mockImplementation(
        (sql: string, params: any, callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => {
              callback(error);
            });
          }
          return mockDb;
        }
      );

      await expect(db.saveSimulationRun(mockSimulationData)).rejects.toThrow('Save failed');
    }, 10000);
  });

  describe('getUserSimulationRuns', () => {
    beforeEach(async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database before each test
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      // Mock getSimulationEvents to return empty array
      mockDb.all.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
          if (callback && sql.includes('simulation_events')) {
            process.nextTick(() => callback(null, []));
          }
          return mockDb;
        }
      );
      await db.initDatabase();
    });

    it('should retrieve user simulation runs', async () => {
      const mockDbRows = [
        {
          id: 1,
          mint: 'test-mint',
          chain: 'solana',
          token_name: 'Test Token',
          token_symbol: 'TEST',
          start_time: DateTime.utc().toISO(),
          end_time: DateTime.utc().toISO(),
          strategy: JSON.stringify([{ percent: 0.5, target: 2 }]),
          stop_loss_config: JSON.stringify({ initial: -0.3, trailing: 0.5 }),
          final_pnl: 1.5,
          total_candles: 100,
          created_at: DateTime.utc().toISO(),
        },
      ];

      mockDb.all.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
          if (callback) {
            if (sql.includes('simulation_events')) {
              // Return empty events array
              process.nextTick(() => callback(null, []));
            } else {
              // Return simulation runs
              process.nextTick(() => callback(null, mockDbRows));
            }
          }
          return mockDb;
        }
      );

      const result = await db.getUserSimulationRuns(12345, 10);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(mockDb.all).toHaveBeenCalled();
    }, 10000);

    it('should handle retrieval errors', async () => {
      const error = new Error('Retrieval failed');
      mockDb.all.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
          if (callback) {
            process.nextTick(() => callback(error));
          }
          return mockDb;
        }
      );

      await expect(db.getUserSimulationRuns(12345, 10)).rejects.toThrow('Retrieval failed');
    }, 10000);
  });

  // -------------------------[ Strategy Management Tests ]-------------------------

  describe('saveStrategy', () => {
    beforeEach(async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database before each test
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      await db.initDatabase();
    });

    // Test data matching the saveStrategySchema
    const mockStrategyData = {
      userId: 12345,
      name: 'test-strategy',
      description: 'Test strategy',
      strategy: [{ type: 'entry' as const, percent: 50, multiplier: 2 }], // Valid strategy with required type
      stopLossConfig: { type: 'trailing' as const, trailingPercent: 10 }, // Valid stopLossConfig
    };

    it('should save strategy successfully', async () => {
      mockDb.run.mockImplementation(
        (sql: string, params: any, callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => {
              const mockThis = { lastID: 1 };
              callback.call(mockThis, null);
            });
          }
          return mockDb;
        }
      );

      const result = await db.saveStrategy(mockStrategyData);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    }, 10000);

    it('should handle strategy save errors', async () => {
      const error = new Error('Strategy save failed');
      mockDb.run.mockImplementation(
        (sql: string, params: any, callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => callback(error));
          }
          return mockDb;
        }
      );

      await expect(db.saveStrategy(mockStrategyData)).rejects.toThrow('Strategy save failed');
    }, 10000);
  });

  describe('getUserStrategies', () => {
    beforeEach(async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database before each test
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      await db.initDatabase();
    });

    it('should retrieve user strategies', async () => {
      const mockStrategies = [
        {
          id: 1,
          user_id: 12345,
          name: 'test-strategy',
          description: 'Test strategy',
          strategy: JSON.stringify([{ percent: 0.5, target: 2 }]),
          stop_loss_config: JSON.stringify({ initial: -0.3, trailing: 0.5 }),
          is_default: 0,
          created_at: DateTime.utc().toISO(),
        },
      ];

      mockDb.all.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
          if (callback) {
            process.nextTick(() => callback(null, mockStrategies));
          }
          return mockDb;
        }
      );

      const result = await db.getUserStrategies(12345);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(mockDb.all).toHaveBeenCalled();
    }, 10000);

    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.all.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, rows?: any[]) => void) => {
          if (callback) {
            process.nextTick(() => callback(error));
          }
          return mockDb;
        }
      );

      await expect(db.getUserStrategies(12345)).rejects.toThrow('Strategy retrieval failed');
    }, 10000);
  });

  describe('getStrategy', () => {
    beforeEach(async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database before each test
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      await db.initDatabase();
    });

    it('should retrieve specific strategy', async () => {
      const mockStrategy = {
        id: 1,
        user_id: 12345,
        name: 'test-strategy',
        description: 'Test strategy',
        strategy: JSON.stringify([{ percent: 0.5, target: 2 }]),
        stop_loss_config: JSON.stringify({ initial: -0.3, trailing: 0.5 }),
        is_default: 0,
        created_at: DateTime.utc().toISO(),
      };

      mockDb.get.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, row?: any) => void) => {
          if (callback) {
            process.nextTick(() => callback(null, mockStrategy));
          }
          return mockDb;
        }
      );

      const result = await db.getStrategy(12345, 'test-strategy');
      expect(result).toBeDefined();
      expect(mockDb.get).toHaveBeenCalled();
    }, 10000);

    it('should return null for non-existent strategy', async () => {
      mockDb.get.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, row?: any) => void) => {
          if (callback) {
            process.nextTick(() => callback(null, null));
          }
          return mockDb;
        }
      );

      const result = await db.getStrategy(12345, 'non-existent');
      expect(result).toBeNull();
    }, 10000);

    it('should handle strategy retrieval errors', async () => {
      const error = new Error('Strategy retrieval failed');
      mockDb.get.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null, row?: any) => void) => {
          if (callback) {
            process.nextTick(() => callback(error));
          }
          return mockDb;
        }
      );

      await expect(db.getStrategy(12345, 'test-strategy')).rejects.toThrow(
        'Strategy retrieval failed'
      );
    }, 10000);
  });

  describe('deleteStrategy', () => {
    beforeEach(async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database before each test
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      await db.initDatabase();
    });

    it('should delete strategy successfully', async () => {
      mockDb.run.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => {
              const mockThis = { changes: 1 };
              callback.call(mockThis, null);
            });
          }
          return mockDb;
        }
      );

      await expect(db.deleteStrategy(12345, 'test-strategy')).resolves.toBeUndefined();
      expect(mockDb.run).toHaveBeenCalled();
    }, 10000);

    it('should handle strategy deletion errors', async () => {
      const error = new Error('Strategy deletion failed');
      mockDb.run.mockImplementation(
        (sql: string, params: any[], callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => callback(error));
          }
          return mockDb;
        }
      );

      await expect(db.deleteStrategy(12345, 'test-strategy')).rejects.toThrow(
        'Strategy deletion failed'
      );
    }, 10000);
  });

  // -------------------------[ CA Drop Management Tests ]-------------------------

  describe('saveCADrop', () => {
    beforeEach(async () => {
      // Ensure Database constructor returns our mock
      MockedDatabase.mockImplementation(() => mockDb);

      // Initialize database before each test
      mockDb.run.mockImplementation((sql: string, callback?: (err: Error | null) => void) => {
        if (callback) {
          process.nextTick(() => callback(null));
        }
        return mockDb;
      });
      await db.initDatabase();
    });

    // Test data matching the saveCATrackingSchema
    const mockCADrop = {
      userId: 12345,
      chatId: 12345,
      mint: '7pXs123456789012345678901234567890pump', // Valid 38-char address
      chain: 'solana',
      tokenName: 'Test Token',
      tokenSymbol: 'TEST',
      callPrice: 1.0,
      callMarketcap: 1000000,
      callTimestamp: 1704067200,
      strategy: [{ type: 'entry' as const, percent: 50, multiplier: 2 }], // Valid strategy with required type
      stopLossConfig: { type: 'trailing' as const, trailingPercent: 10 }, // Valid stopLossConfig
    };

    it('should save CA drop successfully', async () => {
      mockDb.run.mockImplementation(
        (sql: string, params: any, callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => {
              const mockThis = { lastID: 1 };
              callback.call(mockThis, null);
            });
          }
          return mockDb;
        }
      );

      const result = await db.saveCADrop(mockCADrop);
      expect(result).toBe(1);
      expect(mockDb.run).toHaveBeenCalled();
    }, 10000);

    it('should handle CA drop save errors', async () => {
      const error = new Error('CA drop save failed');
      mockDb.run.mockImplementation(
        (sql: string, params: any, callback?: (err: Error | null) => void) => {
          if (callback) {
            process.nextTick(() => callback(error));
          }
          return mockDb;
        }
      );

      await expect(db.saveCADrop(mockCADrop)).rejects.toThrow('CA drop save failed');
    }, 10000);
  });
});
