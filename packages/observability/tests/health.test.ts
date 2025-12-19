import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performHealthCheck, simpleHealthCheck } from '../src/health.js';
import { getClickHouseClient } from '@quantbot/storage';
import { checkApiQuotas } from '../src/quotas.js';

vi.mock('@quantbot/storage', () => ({
  getClickHouseClient: vi.fn(),
}));

vi.mock('../src/quotas', () => ({
  checkApiQuotas: vi.fn(),
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
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ json: async () => [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 1000, limit: 10000, warningThreshold: 100, used: 9000, service: 'birdeye', resetAt: new Date() },
        helius: { remaining: 5000, limit: 10000, warningThreshold: 1000, used: 5000, service: 'helius', resetAt: new Date() },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('healthy');
      expect(result.checks.clickhouse.status).toBe('ok');
      expect(result.checks.birdeye.status).toBe('ok');
      expect(result.checks.helius.status).toBe('ok');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should return degraded status when API quotas are low', async () => {
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ json: async () => [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 50, limit: 10000, warningThreshold: 100, used: 9950, service: 'birdeye', resetAt: new Date() },
        helius: { remaining: 500, limit: 10000, warningThreshold: 1000, used: 9500, service: 'helius', resetAt: new Date() },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('degraded');
      expect(result.checks.birdeye.status).toBe('warning');
      expect(result.checks.helius.status).toBe('warning');
    });

    it('should return unhealthy status when databases fail', async () => {
      const mockClickHouse = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 1000, limit: 10000, warningThreshold: 100, used: 9000, service: 'birdeye', resetAt: new Date() },
        helius: { remaining: 5000, limit: 10000, warningThreshold: 1000, used: 5000, service: 'helius', resetAt: new Date() },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.clickhouse.status).toBe('error');
    });

    it('should return unhealthy status when API quotas are exhausted', async () => {
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ json: async () => [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);
      vi.mocked(checkApiQuotas).mockResolvedValue({
        birdeye: { remaining: 0, limit: 10000, warningThreshold: 100, used: 10000, service: 'birdeye', resetAt: new Date() },
        helius: { remaining: 0, limit: 10000, warningThreshold: 1000, used: 10000, service: 'helius', resetAt: new Date() },
      });

      const result = await performHealthCheck();

      expect(result.status).toBe('unhealthy');
      expect(result.checks.birdeye.status).toBe('error');
      expect(result.checks.helius.status).toBe('error');
    });

    it('should handle quota check failures gracefully', async () => {
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ json: async () => [{ '?column?': 1 }] }),
      };

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
      const mockClickHouse = {
        query: vi.fn().mockResolvedValue({ json: async () => [{ '?column?': 1 }] }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await simpleHealthCheck();

      expect(result.status).toBe('ok');
    });

    it('should return error when database is inaccessible', async () => {
      const mockClickHouse = {
        query: vi.fn().mockRejectedValue(new Error('Connection failed')),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouse as any);

      const result = await simpleHealthCheck();

      expect(result.status).toBe('error');
    });
  });
});
