import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDatabaseHealth } from '../src/database-health.js';
import { getClickHouseClient } from '@quantbot/infra/storage';

vi.mock('@quantbot/infra/storage', () => ({
  getClickHouseClient: vi.fn(),
}));

describe('Database Health Monitoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkDatabaseHealth', () => {
    it('should return healthy status when ClickHouse is connected', async () => {
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ json: async () => [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.clickhouse.connected).toBe(true);
      expect(result.clickhouse.latency).toBeGreaterThanOrEqual(0);
      expect(result.clickhouse.error).toBeUndefined();
    });

    it('should return error when ClickHouse fails', async () => {
      const mockClickHouse = {
        query: vi.fn().mockRejectedValue(new Error('ClickHouse connection failed')),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.clickhouse.connected).toBe(false);
      expect(result.clickhouse.error).toBe('ClickHouse connection failed');
      expect(result.clickhouse.latency).toBeUndefined();
    });

    it('should measure latency correctly', async () => {
      const delayMs = 20;
      const mockClickHouse = {
        query: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({ json: async () => [{ '?column?': 1 }] });
            }, delayMs);
          });
        }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      // Latency should be at least the delay, with some tolerance for test execution overhead
      // Using >= delayMs - 5 to account for timing precision and test overhead
      // Timing can vary slightly due to event loop scheduling, so allow some margin
      expect(result.clickhouse.latency).toBeGreaterThanOrEqual(delayMs - 5);
      // Latency should not be excessively high (allowing up to 100ms for test overhead)
      expect(result.clickhouse.latency).toBeLessThan(100);
      expect(result.clickhouse.connected).toBe(true);
    });
  });
});
