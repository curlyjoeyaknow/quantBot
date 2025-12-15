import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performHealthCheck, simpleHealthCheck } from '../src/health';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { checkApiQuotas } from '../src/quotas';
import { checkDatabaseHealth } from '../src/database-health';

vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(),
  getClickHouseClient: vi.fn(),
}));

vi.mock('../src/quotas', () => ({
  checkApiQuotas: vi.fn(),
}));

vi.mock('../src/database-health', () => ({
  checkDatabaseHealth: vi.fn(),
}));

describe('Health Check Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('performHealthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 1000, limit: 10000, warningThreshold: 100 },
        helius: { remaining: 5000, limit: 10000, warningThreshold: 1000 },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('healthy');
      expect(result.checks.postgres.status).toBe('ok');
      expect(result.checks.clickhouse.status).toBe('ok');
      expect(result.checks.birdeye.status).toBe('ok');
      expect(result.checks.helius.status).toBe('ok');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return degraded status when API quotas are low', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 50, limit: 10000, warningThreshold: 100 },
        helius: { remaining: 500, limit: 10000, warningThreshold: 1000 },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('degraded');
      expect(result.checks.birdeye.status).toBe('warning');
      expect(result.checks.helius.status).toBe('warning');
    });

    it('should return unhealthy status when databases fail', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };
      const mockClickHouse = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 1000, limit: 10000, warningThreshold: 100 },
        helius: { remaining: 5000, limit: 10000, warningThreshold: 1000 },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.postgres.status).toBe('error');
      expect(result.checks.clickhouse.status).toBe('error');
    });

    it('should return unhealthy status when API quotas are exhausted', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 0, limit: 10000, warningThreshold: 100 },
        helius: { remaining: 0, limit: 10000, warningThreshold: 1000 },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.birdeye.status).toBe('error');
      expect(result.checks.helius.status).toBe('error');
    });

    it('should handle quota check failures gracefully', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockRejectedValue(new Error('Quota check failed'));

      const result = await performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.birdeye.status).toBe('error');
      expect(result.checks.helius.status).toBe('error');
    });
  });

  describe('simpleHealthCheck', () => {
    it('should return ok when database is accessible', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);

      const result = await simpleHealthCheck();

      expect(result.status).toBe('ok');
    });

    it('should return error when database is inaccessible', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);

      const result = await simpleHealthCheck();

      expect(result.status).toBe('error');
    });
  });
});
