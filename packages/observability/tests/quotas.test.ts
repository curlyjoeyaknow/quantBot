/**
 * API Quota Tests
 * ===============
 * Unit tests for API quota tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkApiQuotas, recordApiUsage, hasQuotaAvailable } from '../src/quotas';
import { ApiQuotaRepository } from '@quantbot/storage';

// Mock the repository
const mockRepoInstance = {
  getUsageThisMonth: vi.fn(),
  recordUsage: vi.fn(),
  getQuotaStatus: vi.fn(),
};

vi.mock('@quantbot/storage', () => ({
  ApiQuotaRepository: class {
    constructor() {
      return mockRepoInstance;
    }
  },
}));

describe('API Quotas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepoInstance.getUsageThisMonth.mockReset();
    mockRepoInstance.recordUsage.mockReset();
    mockRepoInstance.getQuotaStatus.mockReset();
  });

  describe('checkApiQuotas', () => {
    it('should return quota status for all services', async () => {
      mockRepoInstance.getQuotaStatus
        .mockResolvedValueOnce({
          service: 'birdeye',
          limit: 100000,
          used: 50000,
          remaining: 50000,
          resetAt: new Date(),
          warningThreshold: 0.2,
        })
        .mockResolvedValueOnce({
          service: 'helius',
          limit: 5000000,
          used: 1000000,
          remaining: 4000000,
          resetAt: new Date(),
          warningThreshold: 0.2,
        });

      const quotas = await checkApiQuotas();

      expect(quotas.birdeye).toBeDefined();
      expect(quotas.helius).toBeDefined();
      expect(quotas.birdeye.used).toBe(50000);
      expect(quotas.helius.used).toBe(1000000);
    });

    it('should use environment variables for limits', async () => {
      process.env.BIRDEYE_QUOTA_LIMIT = '200000';
      process.env.HELIUS_QUOTA_LIMIT = '10000000';

      mockRepoInstance.getQuotaStatus.mockResolvedValue({
        service: 'birdeye',
        limit: 200000,
        used: 0,
        remaining: 200000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      });

      await checkApiQuotas();

      expect(mockRepoInstance.getQuotaStatus).toHaveBeenCalledWith('birdeye', 200000, 0.2);
    });
  });

  describe('recordApiUsage', () => {
    it('should record API usage', async () => {
      await recordApiUsage('birdeye', 100);

      expect(mockRepoInstance.recordUsage).toHaveBeenCalledWith('birdeye', 100, undefined);
    });

    it('should record API usage with metadata', async () => {
      const metadata = { endpoint: '/test', count: 5 };
      await recordApiUsage('helius', 200, metadata);

      expect(mockRepoInstance.recordUsage).toHaveBeenCalledWith('helius', 200, metadata);
    });
  });

  describe('hasQuotaAvailable', () => {
    it('should return true when quota is available', async () => {
      mockRepoInstance.getQuotaStatus.mockResolvedValue({
        service: 'birdeye',
        limit: 100000,
        used: 50000,
        remaining: 50000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      });

      const available = await hasQuotaAvailable('birdeye', 10000);

      expect(available).toBe(true);
    });

    it('should return false when quota is insufficient', async () => {
      mockRepoInstance.getQuotaStatus.mockResolvedValue({
        service: 'birdeye',
        limit: 100000,
        used: 95000,
        remaining: 5000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      });

      const available = await hasQuotaAvailable('birdeye', 10000);

      expect(available).toBe(false);
    });
  });
});
