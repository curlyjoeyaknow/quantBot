/**
 * API Quota Tests
 * ===============
 * Unit tests for API quota tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkApiQuotas, recordApiUsage, hasQuotaAvailable } from '../src/quotas';

vi.mock('@quantbot/infra/utils', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

describe('API Quotas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.BIRDEYE_QUOTA_LIMIT;
    delete process.env.HELIUS_QUOTA_LIMIT;
  });

  describe('checkApiQuotas', () => {
    it('should return quota status for all services', async () => {
      const quotas = await checkApiQuotas();

      expect(quotas.birdeye).toBeDefined();
      expect(quotas.helius).toBeDefined();
      expect(quotas.birdeye.service).toBe('birdeye');
      expect(quotas.helius.service).toBe('helius');
      expect(quotas.birdeye.limit).toBe(100000); // Default limit
      expect(quotas.helius.limit).toBe(5000000); // Default limit
      expect(quotas.birdeye.used).toBe(0); // Default used
      expect(quotas.helius.used).toBe(0); // Default used
    });

    it('should use environment variables for limits', async () => {
      process.env.BIRDEYE_QUOTA_LIMIT = '200000';
      process.env.HELIUS_QUOTA_LIMIT = '10000000';

      const quotas = await checkApiQuotas();

      expect(quotas.birdeye.limit).toBe(200000);
      expect(quotas.helius.limit).toBe(10000000);
    });
  });

  describe('recordApiUsage', () => {
    it('should record API usage', async () => {
      // Currently just logs, no repository implementation
      await recordApiUsage('birdeye', 100);
      // Should not throw
      expect(true).toBe(true);
    });

    it('should record API usage with metadata', async () => {
      const metadata = { endpoint: '/test', count: 5 };
      // Currently just logs, no repository implementation
      await recordApiUsage('helius', 200, metadata);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('hasQuotaAvailable', () => {
    it('should return true when quota is available', async () => {
      const available = await hasQuotaAvailable('birdeye', 10000);

      // Default limit is 100000, used is 0, so 10000 should be available
      expect(available).toBe(true);
    });

    it('should return false when quota is insufficient', async () => {
      // Set a low limit to test insufficient quota
      process.env.BIRDEYE_QUOTA_LIMIT = '5000';

      const available = await hasQuotaAvailable('birdeye', 10000);

      // Limit is 5000, required is 10000, so should be false
      expect(available).toBe(false);
    });
  });
});
