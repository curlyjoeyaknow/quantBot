/**
 * Caller Database Tests
 * ======================
 * Unit tests for CallerDatabase
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { CallerDatabase, type CallerAlert, type CallerStats } from '../../src/caller-database';

// Mock sqlite3
const { mockDatabase, mockDb } = vi.hoisted(() => {
  const mockDb = {
    run: vi.fn(),
    all: vi.fn(),
    prepare: vi.fn(),
    close: vi.fn(),
  };
  // Create a proper constructor function
  const mockDatabase = function (this: any) {
    return mockDb;
  } as any;
  mockDatabase.prototype = {};
  return { mockDatabase, mockDb };
});

vi.mock('sqlite3', () => ({
  Database: mockDatabase,
}));

vi.mock('util', () => ({
  promisify: (fn: any) => {
    return (...args: any[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: any, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
  },
}));

describe('CallerDatabase', () => {
  let db: CallerDatabase;
  let mockRun: any;
  let mockAll: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default implementations for promisified calls
    // promisify always provides a callback as the last argument
    mockDb.run.mockImplementation((sql: string, params: any[], callback?: any) => {
      if (typeof callback === 'function') {
        callback(null, { lastID: 1, changes: 1 });
      }
      return { lastID: 1, changes: 1 };
    });

    mockDb.all.mockImplementation((sql: string, params: any[], callback?: any) => {
      if (typeof callback === 'function') {
        callback(null, []);
      }
      return [];
    });

    mockDb.close.mockImplementation((callback?: any) => {
      if (typeof callback === 'function') {
        callback(null);
      }
    });

    db = new CallerDatabase(':memory:');
  });

  describe('addCallerAlert', () => {
    it('should add a new caller alert', async () => {
      const alert: CallerAlert = {
        callerName: 'caller1',
        tokenAddress: 'So11111111111111111111111111111111111111112',
        tokenSymbol: 'TOKEN',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        alertMessage: 'Test alert',
        priceAtAlert: 1.0,
        volumeAtAlert: 1000,
        createdAt: new Date('2024-01-01'),
      };

      const id = await db.addCallerAlert(alert);

      expect(id).toBe(1);
      expect(mockRun).toHaveBeenCalled();
      // Find the INSERT call (skip initDatabase calls)
      const insertCall = mockRun.mock.calls.find((call) => call[0].includes('INSERT OR IGNORE'));
      expect(insertCall).toBeDefined();
      if (insertCall) {
        expect(insertCall[0]).toContain('INSERT OR IGNORE');
        const params = insertCall[1] || [];
        const paramsStr = Array.isArray(params) ? params.join(' ') : String(params);
        expect(paramsStr).toContain('caller1');
        expect(paramsStr).toContain('So11111111111111111111111111111111111111112');
      }
    });

    it('should preserve case of token address', async () => {
      const alert: CallerAlert = {
        callerName: 'caller1',
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
      };

      await db.addCallerAlert(alert);

      // Find the INSERT call (skip initDatabase calls)
      const insertCall = mockRun.mock.calls.find((call) => call[0].includes('INSERT OR IGNORE'));
      expect(insertCall).toBeDefined();
      if (insertCall) {
        const params = insertCall[1] || [];
        const paramsStr = Array.isArray(params) ? params.join(' ') : String(params);
        expect(paramsStr).toContain('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      }
    });

    it('should handle database errors', async () => {
      mockRun.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(new Error('Database error'));
      });

      const alert: CallerAlert = {
        callerName: 'caller1',
        tokenAddress: 'token1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
      };

      await expect(db.addCallerAlert(alert)).rejects.toThrow('Database error');
    });
  });

  describe('addCallerAlertsBatch', () => {
    it('should batch add multiple alerts', async () => {
      const alerts: CallerAlert[] = [
        {
          callerName: 'caller1',
          tokenAddress: 'token1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
        },
        {
          callerName: 'caller1',
          tokenAddress: 'token2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          createdAt: new Date('2024-01-02'),
        },
      ];

      const mockStmt = {
        run: vi.fn(function (this: any, params: any[], callback?: any) {
          // Set this.changes for sqlite3 callback behavior
          this.changes = 1;
          if (typeof callback === 'function') {
            callback.call(this, null);
          }
          return this;
        }),
        finalize: vi.fn((callback?: any) => {
          if (typeof callback === 'function') {
            callback(null);
          }
        }),
      };

      mockDb.prepare.mockReturnValue(mockStmt);

      const count = await db.addCallerAlertsBatch(alerts);

      expect(count).toBe(2);
      expect(mockStmt.run).toHaveBeenCalledTimes(2);
      expect(mockStmt.finalize).toHaveBeenCalled();
    });

    it('should handle duplicate alerts gracefully', async () => {
      const alerts: CallerAlert[] = [
        {
          callerName: 'caller1',
          tokenAddress: 'token1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          createdAt: new Date('2024-01-01'),
        },
      ];

      const mockStmt = {
        run: vi.fn(function (this: any, params: any[], callback?: any) {
          const error = new Error('UNIQUE constraint failed');
          if (typeof callback === 'function') {
            callback.call(this, error);
          }
          return this;
        }),
        finalize: vi.fn((callback?: any) => {
          if (typeof callback === 'function') {
            callback(null);
          }
        }),
      };

      mockDb.prepare.mockReturnValue(mockStmt);

      const count = await db.addCallerAlertsBatch(alerts);

      expect(count).toBe(0);
    });
  });

  describe('getCallerAlerts', () => {
    it('should get alerts for a caller', async () => {
      const mockRows = [
        {
          id: 1,
          caller_name: 'caller1',
          token_address: 'token1',
          token_symbol: 'TOKEN1',
          chain: 'solana',
          alert_timestamp: '2024-01-01T00:00:00.000Z',
          alert_message: 'Test',
          price_at_alert: 1.0,
          volume_at_alert: 1000,
          created_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      mockAll.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(null, mockRows);
      });

      const result = await db.getCallerAlerts('caller1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        callerName: 'caller1',
        tokenAddress: 'token1',
        tokenSymbol: 'TOKEN1',
        chain: 'solana',
      });
    });

    it('should apply limit when provided', async () => {
      mockAll.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(null, []);
      });

      await db.getCallerAlerts('caller1', 10);

      const callArgs = mockAll.mock.calls[0];
      expect(callArgs[0]).toContain('LIMIT');
      expect(callArgs[1]).toContain(10);
    });
  });

  describe('getCallerAlertsInRange', () => {
    it('should get alerts within date range', async () => {
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-31T00:00:00Z').toJSDate();

      mockAll.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(null, []);
      });

      await db.getCallerAlertsInRange('caller1', startTime, endTime);

      const callArgs = mockAll.mock.calls[0];
      expect(callArgs[0]).toContain('alert_timestamp >=');
      expect(callArgs[0]).toContain('alert_timestamp <=');
      expect(callArgs[1]).toContain(startTime.toISOString());
      expect(callArgs[1]).toContain(endTime.toISOString());
    });
  });

  describe('getAllCallers', () => {
    it('should get all unique callers', async () => {
      const mockRows = [{ caller_name: 'caller1' }, { caller_name: 'caller2' }];

      mockDb.all.mockImplementationOnce((sql: string, params: any[], callback?: any) => {
        if (typeof callback === 'function') {
          callback(null, mockRows);
        }
        return mockRows;
      });

      const result = await db.getAllCallers();

      expect(result).toEqual(['caller1', 'caller2']);
    });
  });

  describe('getCallerStats', () => {
    it('should calculate caller statistics', async () => {
      const mockRows = [
        {
          caller_name: 'caller1',
          total_alerts: 10,
          unique_tokens: 5,
          first_alert: '2024-01-01T00:00:00.000Z',
          last_alert: '2024-01-10T00:00:00.000Z',
          avg_alerts_per_day: 1.11,
        },
      ];

      mockAll.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(null, mockRows);
      });

      const result = await db.getCallerStats('caller1');

      expect(result).toMatchObject({
        callerName: 'caller1',
        totalAlerts: 10,
        uniqueTokens: 5,
        firstAlert: new Date('2024-01-01T00:00:00.000Z'),
        lastAlert: new Date('2024-01-10T00:00:00.000Z'),
        avgAlertsPerDay: 1.11,
      });
    });

    it('should return null for non-existent caller', async () => {
      mockAll.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(null, []);
      });

      const result = await db.getCallerStats('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getAllCallerStats', () => {
    it('should get statistics for all callers', async () => {
      const mockRows = [
        {
          caller_name: 'caller1',
          total_alerts: 10,
          unique_tokens: 5,
          first_alert: '2024-01-01T00:00:00.000Z',
          last_alert: '2024-01-10T00:00:00.000Z',
          avg_alerts_per_day: 1.11,
        },
        {
          caller_name: 'caller2',
          total_alerts: 5,
          unique_tokens: 3,
          first_alert: '2024-01-05T00:00:00.000Z',
          last_alert: '2024-01-10T00:00:00.000Z',
          avg_alerts_per_day: 0.83,
        },
      ];

      mockDb.all.mockImplementationOnce((sql: string, params: any[], callback?: any) => {
        if (typeof callback === 'function') {
          callback(null, mockRows);
        }
        return mockRows;
      });

      const result = await db.getAllCallerStats();

      expect(result).toHaveLength(2);
      expect(result[0].totalAlerts).toBeGreaterThanOrEqual(result[1].totalAlerts); // Sorted by total alerts
    });
  });

  describe('getCallerTokens', () => {
    it('should get tokens for a caller', async () => {
      const mockRows = [
        {
          token_address: 'token1',
          token_symbol: 'TOKEN1',
          chain: 'solana',
          alert_count: 5,
        },
        {
          token_address: 'token2',
          token_symbol: 'TOKEN2',
          chain: 'solana',
          alert_count: 3,
        },
      ];

      mockAll.mockImplementation((sql: string, params: any[], callback: any) => {
        callback(null, mockRows);
      });

      const result = await db.getCallerTokens('caller1');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        tokenAddress: 'token1',
        tokenSymbol: 'TOKEN1',
        chain: 'solana',
        alertCount: 5,
      });
    });
  });

  describe('getDatabaseStats', () => {
    it('should get overall database statistics', async () => {
      const mockRows = [
        {
          total_alerts: 100,
          total_callers: 10,
          total_tokens: 50,
          earliest_alert: '2024-01-01T00:00:00.000Z',
          latest_alert: '2024-01-31T00:00:00.000Z',
        },
      ];

      mockDb.all.mockImplementationOnce((sql: string, params: any[], callback?: any) => {
        if (typeof callback === 'function') {
          callback(null, mockRows);
        }
        return mockRows;
      });

      const result = await db.getDatabaseStats();

      expect(result).toMatchObject({
        totalAlerts: 100,
        totalCallers: 10,
        totalTokens: 50,
        dateRange: {
          start: new Date('2024-01-01T00:00:00.000Z'),
          end: new Date('2024-01-31T00:00:00.000Z'),
        },
      });
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      mockDb.close.mockImplementation((callback: any) => {
        callback(null);
      });

      await db.close();

      expect(mockDb.close).toHaveBeenCalled();
    });

    it('should handle close errors', async () => {
      mockDb.close.mockImplementation((callback: any) => {
        callback(new Error('Close error'));
      });

      await expect(db.close()).rejects.toThrow('Close error');
    });
  });
});
