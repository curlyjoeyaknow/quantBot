import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDatabaseHealth } from '../src/database-health.js';
import { getClickHouseClient } from '@quantbot/storage';

vi.mock('@quantbot/storage', () => ({
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
      const mockClickHouse = {
        query: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({ json: async () => [{ '?column?': 1 }] });
            }, 20);
          });
        }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.clickhouse.latency).toBeGreaterThanOrEqual(20);
    });
  });
});
