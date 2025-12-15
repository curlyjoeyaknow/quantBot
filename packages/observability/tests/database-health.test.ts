import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkDatabaseHealth } from '../src/database-health';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';

vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(),
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
    it('should return healthy status when both databases are connected', async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(() => {
          return Promise.resolve({ rows: [{ '?column?': 1 }] });
        }),
      };
      const mockClickHouse = {
        query: vi.fn().mockImplementation(() => {
          return Promise.resolve({ rows: [{ '?column?': 1 }] });
        }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.postgres.connected).toBe(true);
      expect(result.postgres.latency).toBeGreaterThanOrEqual(0);
      expect(result.postgres.error).toBeUndefined();

      expect(result.clickhouse.connected).toBe(true);
      expect(result.clickhouse.latency).toBeGreaterThanOrEqual(0);
      expect(result.clickhouse.error).toBeUndefined();
    });

    it('should return error when PostgreSQL fails', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('PostgreSQL connection failed')),
      };
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.postgres.connected).toBe(false);
      expect(result.postgres.error).toBe('PostgreSQL connection failed');
      expect(result.postgres.latency).toBeUndefined();

      expect(result.clickhouse.connected).toBe(true);
    });

    it('should return error when ClickHouse fails', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };
      const mockClickHouse = {
        query: vi.fn().mockRejectedValue(new Error('ClickHouse connection failed')),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.postgres.connected).toBe(true);

      expect(result.clickhouse.connected).toBe(false);
      expect(result.clickhouse.error).toBe('ClickHouse connection failed');
      expect(result.clickhouse.latency).toBeUndefined();
    });

    it('should return errors when both databases fail', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('PostgreSQL connection failed')),
      };
      const mockClickHouse = {
        query: vi.fn().mockRejectedValue(new Error('ClickHouse connection failed')),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.postgres.connected).toBe(false);
      expect(result.postgres.error).toBe('PostgreSQL connection failed');

      expect(result.clickhouse.connected).toBe(false);
      expect(result.clickhouse.error).toBe('ClickHouse connection failed');
    });

    it('should measure latency correctly', async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({ rows: [{ '?column?': 1 }] });
            }, 10);
          });
        }),
      };
      const mockClickHouse = {
        query: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({ rows: [{ '?column?': 1 }] });
            }, 20);
          });
        }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await checkDatabaseHealth();

      expect(result.postgres.latency).toBeGreaterThanOrEqual(10);
      expect(result.clickhouse.latency).toBeGreaterThanOrEqual(20);
    });
  });
});
