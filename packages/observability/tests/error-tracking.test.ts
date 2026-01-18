/**
 * Error Tracking Tests
 * ====================
 * Unit tests for error tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackError, getErrorStats, _resetErrorRepository } from '../src/error-tracking.js';
import { DateTime } from 'luxon';

// Mock logger and PythonEngine - must be async to avoid hoisting issues
vi.mock('@quantbot/infra/utils', async () => {
  const { vi } = await import('vitest');
  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
    getPythonEngine: vi.fn(() => ({
      runScript: vi.fn(),
    })),
  };
});

// Mock ErrorRepository to avoid DuckDB dependency in unit tests
// Use in-memory storage to simulate real behavior
const mockErrorStore: Array<{
  timestamp: Date;
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  severity: string;
  context?: Record<string, unknown>;
  service?: string;
}> = [];

vi.mock('@quantbot/infra/storage', async () => {
  const { vi } = await import('vitest');
  return {
    ErrorRepository: class {
      constructor(_dbPath: string) {
        // Mock constructor
      }
      async insertError(error: {
        timestamp: Date;
        errorName: string;
        errorMessage: string;
        errorStack?: string;
        severity: string;
        context?: Record<string, unknown>;
        service?: string;
      }) {
        // Store in mock store
        mockErrorStore.push(error);
      }
      async getStats(options: { startDate: Date; endDate: Date; service?: string }) {
        const filtered = mockErrorStore.filter((e) => {
          const inRange = e.timestamp >= options.startDate && e.timestamp <= options.endDate;
          const serviceMatch = !options.service || e.service === options.service;
          return inRange && serviceMatch;
        });

        const bySeverity: Record<string, number> = {};
        for (const error of filtered) {
          bySeverity[error.severity] = (bySeverity[error.severity] || 0) + 1;
        }

        return {
          total: filtered.length,
          bySeverity: {
            critical: bySeverity.critical || 0,
            high: bySeverity.high || 0,
            medium: bySeverity.medium || 0,
            low: bySeverity.low || 0,
          },
          resolvedCount: 0, // Mock doesn't track resolution
        };
      }
      async getRecentErrors(options: {
        startDate: Date;
        endDate: Date;
        service?: string;
        limit: number;
      }) {
        const filtered = mockErrorStore
          .filter((e) => {
            const inRange = e.timestamp >= options.startDate && e.timestamp <= options.endDate;
            const serviceMatch = !options.service || e.service === options.service;
            return inRange && serviceMatch;
          })
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .slice(0, options.limit)
          .map((e) => ({
            id: mockErrorStore.indexOf(e) + 1,
            timestamp: DateTime.fromJSDate(e.timestamp),
            errorName: e.errorName,
            errorMessage: e.errorMessage,
            errorStack: e.errorStack,
            severity: e.severity as 'low' | 'medium' | 'high' | 'critical',
            context: e.context,
            service: e.service,
            resolved: false,
            createdAt: DateTime.fromJSDate(e.timestamp),
          }));

        return filtered;
      }
    },
  };
});

describe('Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear mock error store before each test
    mockErrorStore.length = 0;
    // Reset singleton to ensure fresh instance for each test
    _resetErrorRepository();
  });

  describe('trackError', () => {
    it('should track an error', async () => {
      const { logger } = await import('@quantbot/infra/utils');
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      await trackError(error);

      // ErrorRepository is now implemented, so it should be called
      expect(mockErrorStore.length).toBe(1);
      expect(mockErrorStore[0].errorName).toBe('Error');
      expect(mockErrorStore[0].errorMessage).toBe('Test error');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Error tracked',
        error,
        expect.objectContaining({
          severity: 'medium',
        })
      );
    });

    it('should track error with custom severity', async () => {
      const { logger } = await import('@quantbot/infra/utils');
      const error = new Error('Critical error');

      await trackError(error, undefined, 'critical');

      // ErrorRepository is now implemented, so it should be called
      expect(mockErrorStore.length).toBe(1);
      expect(mockErrorStore[0].severity).toBe('critical');
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Error tracked',
        error,
        expect.objectContaining({
          severity: 'critical',
        })
      );
    });

    it('should track error with context', async () => {
      const { logger } = await import('@quantbot/infra/utils');
      const error = new Error('Test error');
      const context = { service: 'test-service', userId: 123 };

      await trackError(error, context);

      // ErrorRepository is now implemented, so it should be called
      expect(mockErrorStore.length).toBe(1);
      expect(mockErrorStore[0].context).toEqual(context);
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Error tracked',
        error,
        expect.objectContaining({
          context,
        })
      );
    });

    it('should not throw if tracking fails', async () => {
      const error = new Error('Test error');

      // ErrorRepository is now implemented, but tracking should not throw on failure
      await expect(trackError(error)).resolves.not.toThrow();
    });
  });

  describe('getErrorStats', () => {
    it('should return error statistics', async () => {
      // First track some errors
      await trackError(new Error('Test error 1'), undefined, 'low');
      await trackError(new Error('Test error 2'), undefined, 'medium');
      await trackError(new Error('Test error 3'), undefined, 'high');

      // Use time range that includes current date
      const now = new Date();
      const timeRange = {
        from: new Date(now.getTime() - 24 * 60 * 60 * 1000), // 24 hours ago
        to: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24 hours from now
      };

      const stats = await getErrorStats(timeRange);

      // Should return stats from mock repository
      expect(stats.total).toBe(3);
      expect(stats.bySeverity.low).toBe(1);
      expect(stats.bySeverity.medium).toBe(1);
      expect(stats.bySeverity.high).toBe(1);
      expect(stats.recent.length).toBe(3);
    });

    it('should return empty stats for time range with no errors', async () => {
      // Use a time range in the past (before any errors were tracked)
      const pastDate = new Date('2020-01-01');
      const stats = await getErrorStats({
        from: pastDate,
        to: pastDate,
      });

      // Should return empty stats for time range with no errors
      // Implementation returns all severity levels with 0 counts
      expect(stats.total).toBe(0);
      expect(stats.bySeverity.critical).toBe(0);
      expect(stats.bySeverity.high).toBe(0);
      expect(stats.bySeverity.medium).toBe(0);
      expect(stats.bySeverity.low).toBe(0);
      expect(stats.recent).toEqual([]);
    });
  });
});
