import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ErrorRepository } from '../../src/postgres/repositories/ErrorRepository';
import { getPostgresPool } from '../../src/postgres-client';
import type { ErrorEvent } from '@quantbot/observability';

vi.mock('../../src/postgres-client', () => ({
  getPostgresPool: vi.fn(),
}));

describe('ErrorRepository', () => {
  let repository: ErrorRepository;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ErrorRepository();
    mockPool = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
  });

  describe('insertError', () => {
    it('should insert an error event', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 1 }] });

      const errorEvent: ErrorEvent = {
        timestamp: new Date(),
        error: 'TestError',
        message: 'Test error message',
        stack: 'Error stack trace',
        severity: 'error',
        context: { service: 'test-service' },
      };

      const result = await repository.insertError(errorEvent);

      expect(result).toBe(1);
      expect(mockPool.query).toHaveBeenCalled();
    });

    it('should handle errors without stack or context', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ id: 2 }] });

      const errorEvent: ErrorEvent = {
        timestamp: new Date(),
        error: 'SimpleError',
        message: 'Simple message',
        severity: 'warning',
      };

      await repository.insertError(errorEvent);

      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  describe('getErrorsInRange', () => {
    it('should get errors in time range', async () => {
      const mockErrors = [
        {
          id: 1,
          timestamp: new Date(),
          error_name: 'TestError',
          error_message: 'Test',
          error_stack: null,
          severity: 'error',
          context_json: null,
          service: 'test-service',
        },
      ];
      mockPool.query.mockResolvedValue({ rows: mockErrors });

      const start = new Date('2024-01-01');
      const end = new Date('2024-01-02');

      const result = await repository.getErrorsInRange(start, end);

      expect(result).toHaveLength(1);
      expect(result[0].error).toBe('TestError');
    });
  });

  describe('getErrorStats', () => {
    it('should get error statistics', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // Total
        .mockResolvedValueOnce({
          rows: [
            { severity: 'error', count: '5' },
            { severity: 'warning', count: '3' },
          ],
        }) // By severity
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              timestamp: new Date(),
              error_name: 'TestError',
              error_message: 'Test',
              error_stack: null,
              severity: 'error',
              context_json: null,
              service: 'test-service',
            },
          ],
        }); // Recent

      const result = await repository.getErrorStats(24);

      expect(result.total).toBe(10);
      expect(result.bySeverity.error).toBe(5);
      expect(result.bySeverity.warning).toBe(3);
      expect(result.recent).toHaveLength(1);
    });
  });
});
