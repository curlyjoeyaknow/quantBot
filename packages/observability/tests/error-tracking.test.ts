/**
 * Error Tracking Tests
 * ====================
 * Unit tests for error tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackError, getErrorStats } from '../src/error-tracking';
import { ErrorRepository } from '@quantbot/storage';

// Mock the repository
const mockRepoInstance = {
  insertError: vi.fn().mockResolvedValue(1),
  getErrorStats: vi.fn(),
};

vi.mock('@quantbot/storage', () => ({
  ErrorRepository: class {
    constructor() {
      return mockRepoInstance;
    }
  },
}));

describe('Error Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoInstance.insertError.mockReset().mockResolvedValue(1);
    mockRepoInstance.getErrorStats.mockReset();
  });

  describe('trackError', () => {
    it('should track an error', async () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';

      await trackError(error);

      expect(mockRepoInstance.insertError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Error',
          message: 'Test error',
          severity: 'medium',
        })
      );
    });

    it('should track error with custom severity', async () => {
      const error = new Error('Critical error');

      await trackError(error, undefined, 'critical');

      expect(mockRepoInstance.insertError).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'critical',
        })
      );
    });

    it('should track error with context', async () => {
      const error = new Error('Test error');
      const context = { service: 'test-service', userId: 123 };

      await trackError(error, context);

      expect(mockRepoInstance.insertError).toHaveBeenCalledWith(
        expect.objectContaining({
          context,
        })
      );
    });

    it('should not throw if tracking fails', async () => {
      mockRepoInstance.insertError.mockRejectedValue(new Error('DB error'));
      const error = new Error('Test error');

      await expect(trackError(error)).resolves.not.toThrow();
    });
  });

  describe('getErrorStats', () => {
    it('should return error statistics', async () => {
      const timeRange = {
        from: new Date('2024-01-01'),
        to: new Date('2024-01-31'),
      };

      const mockStats = {
        total: 100,
        bySeverity: {
          low: 20,
          medium: 50,
          high: 25,
          critical: 5,
        },
        recent: [],
      };

      mockRepoInstance.getErrorStats.mockResolvedValue(mockStats);

      const stats = await getErrorStats(timeRange);

      expect(stats).toEqual(mockStats);
      expect(mockRepoInstance.getErrorStats).toHaveBeenCalledWith(timeRange);
    });

    it('should return empty stats on error', async () => {
      mockRepoInstance.getErrorStats.mockRejectedValue(new Error('DB error'));

      const stats = await getErrorStats({
        from: new Date(),
        to: new Date(),
      });

      expect(stats).toEqual({
        total: 0,
        bySeverity: {},
        recent: [],
      });
    });
  });
});
