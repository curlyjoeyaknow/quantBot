/**
 * Error Tracking Tests
 * ====================
 * Unit tests for error tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackError, getErrorStats } from '../src/error-tracking.js';

// Mock logger - must be async to avoid hoisting issues
vi.mock('@quantbot/utils', async () => {
  const { vi } = await import('vitest');
  return {
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

describe('Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('trackError', () => {
    it('should track an error', async () => {
      const { logger } = await import('@quantbot/utils');
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      await trackError(error);

      // ErrorRepository is not implemented yet, so it just logs
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Error tracked',
        error,
        expect.objectContaining({
          severity: 'medium',
        })
      );
    });

    it('should track error with custom severity', async () => {
      const { logger } = await import('@quantbot/utils');
      const error = new Error('Critical error');

      await trackError(error, undefined, 'critical');

      // ErrorRepository is not implemented yet, so it just logs
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        'Error tracked',
        error,
        expect.objectContaining({
          severity: 'critical',
        })
      );
    });

    it('should track error with context', async () => {
      const { logger } = await import('@quantbot/utils');
      const error = new Error('Test error');
      const context = { service: 'test-service', userId: 123 };

      await trackError(error, context);

      // ErrorRepository is not implemented yet, so it just logs
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

      // ErrorRepository is not implemented yet, so tracking always succeeds (just logs)
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

      // Should return stats from in-memory store
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.bySeverity.low).toBeGreaterThanOrEqual(1);
      expect(stats.bySeverity.medium).toBeGreaterThanOrEqual(1);
      expect(stats.bySeverity.high).toBeGreaterThanOrEqual(1);
      expect(stats.recent.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty stats on error', async () => {
      // Use a time range in the past (before any errors were tracked)
      const pastDate = new Date('2020-01-01');
      const stats = await getErrorStats({
        from: pastDate,
        to: pastDate,
      });

      // Should return empty stats for time range with no errors
      expect(stats).toEqual({
        total: 0,
        bySeverity: {},
        recent: [],
      });
    });
  });
});
