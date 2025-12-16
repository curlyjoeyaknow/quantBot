import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { ApiQuotaRepository } from '../../../src/postgres/repositories/ApiQuotaRepository';
import { getPostgresPool } from '../../../src/postgres/postgres-client';

vi.mock('../../../src/postgres/postgres-client', () => ({
  getPostgresPool: vi.fn(),
}));

describe('ApiQuotaRepository', () => {
  let repository: ApiQuotaRepository;
  let mockPool: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ApiQuotaRepository();
    mockPool = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
  });

  describe('recordUsage', () => {
    it('should record API usage', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await repository.recordUsage('birdeye', 10, { endpoint: '/test' });

      expect(mockPool.query).toHaveBeenCalled();
      const query = mockPool.query.mock.calls[0][0];
      expect(query).toContain('INSERT');
      expect(query).toContain('ON CONFLICT');
    });

    it('should handle usage without metadata', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      await repository.recordUsage('helius', 5);

      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  describe('getUsageToday', () => {
    it('should get today usage for a service', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ credits_used: 100 }],
      });

      const result = await repository.getUsageToday('birdeye');

      expect(result).toBe(100);
    });

    it('should return 0 if no usage recorded', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repository.getUsageToday('helius');

      expect(result).toBe(0);
    });
  });

  describe('getUsageThisMonth', () => {
    it('should get usage for this month', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ credits_used: 150 }],
      });

      const result = await repository.getUsageThisMonth('birdeye');

      expect(result).toBe(150);
    });

    it('should return 0 if no usage recorded', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repository.getUsageThisMonth('helius');

      expect(result).toBe(0);
    });
  });
});
