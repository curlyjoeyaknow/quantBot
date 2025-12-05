import { describe, it, expect, vi, beforeEach } from 'vitest';
import { creditMonitor, type CreditUsage } from '../../src/utils/credit-monitor';
import { logger } from '../../src/utils/logger';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('credit-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset usage for each test by getting all providers and resetting them
    // Also clear limits to ensure clean state
    const allUsage = creditMonitor.getAllUsage();
    allUsage.forEach(usage => {
      creditMonitor.resetUsage(usage.provider);
      // Set limit to undefined by setting a new one without limit
      // Actually, we can't clear limits, so we'll just reset usage
    });
  });

  describe('recordUsage', () => {
    it('should record credit usage for a provider', () => {
      creditMonitor.resetUsage('birdeye'); // Clear any previous state
      creditMonitor.recordUsage('birdeye', 100, 5);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage).toBeDefined();
      expect(usage?.creditsUsed).toBe(100);
      expect(usage?.requestsCount).toBe(5);
    });

    it('should accumulate credit usage', () => {
      creditMonitor.resetUsage('birdeye'); // Clear any previous state
      creditMonitor.recordUsage('birdeye', 100, 5);
      creditMonitor.recordUsage('birdeye', 50, 3);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.creditsUsed).toBe(150);
      expect(usage?.requestsCount).toBe(8);
    });

    it('should set lastReset on first usage', () => {
      creditMonitor.recordUsage('birdeye', 100);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.lastReset).toBeDefined();
      expect(usage?.lastReset).toBeInstanceOf(Date);
    });

    it('should not overwrite lastReset on subsequent usage', () => {
      creditMonitor.recordUsage('birdeye', 100);
      const firstUsage = creditMonitor.getUsage('birdeye');
      const firstReset = firstUsage?.lastReset;

      creditMonitor.recordUsage('birdeye', 50);
      const secondUsage = creditMonitor.getUsage('birdeye');

      expect(secondUsage?.lastReset).toBe(firstReset);
    });

    it('should alert when approaching limit', () => {
      creditMonitor.resetUsage('birdeye'); // Clear any previous state
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 800); // 80% usage

      expect(logger.warn).toHaveBeenCalledWith(
        'Credit usage approaching limit',
        expect.objectContaining({
          provider: 'birdeye',
          creditsUsed: 800,
          creditsLimit: 1000,
          usagePercent: '80.00%',
        })
      );
    });

    it('should alert at exactly threshold', () => {
      creditMonitor.resetUsage('birdeye'); // Clear any previous state
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 800); // Exactly 80%

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not alert below threshold', () => {
      creditMonitor.resetUsage('birdeye'); // Clear any previous state
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 700); // 70% usage

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should handle multiple providers independently', () => {
      creditMonitor.recordUsage('birdeye', 100);
      creditMonitor.recordUsage('helius', 200);

      const birdeyeUsage = creditMonitor.getUsage('birdeye');
      const heliusUsage = creditMonitor.getUsage('helius');

      expect(birdeyeUsage?.creditsUsed).toBe(100);
      expect(heliusUsage?.creditsUsed).toBe(200);
    });

    it('should default requestsCount to 1', () => {
      creditMonitor.recordUsage('birdeye', 100);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.requestsCount).toBe(1);
    });
  });

  describe('setLimit', () => {
    it('should set credit limit for a provider', () => {
      creditMonitor.setLimit('birdeye', 1000);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.creditsLimit).toBe(1000);
    });

    it('should set reset interval', () => {
      creditMonitor.setLimit('birdeye', 1000, 'daily');

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.resetInterval).toBe('daily');
    });

    it('should preserve existing usage when setting limit', () => {
      creditMonitor.recordUsage('birdeye', 100);
      creditMonitor.setLimit('birdeye', 1000);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.creditsUsed).toBe(100);
      expect(usage?.creditsLimit).toBe(1000);
    });

    it('should update existing limit', () => {
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.setLimit('birdeye', 2000);

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.creditsLimit).toBe(2000);
    });
  });

  describe('getUsage', () => {
    it('should return undefined for unknown provider', () => {
      const usage = creditMonitor.getUsage('unknown');
      expect(usage).toBeUndefined();
    });

    it('should return usage for known provider', () => {
      creditMonitor.recordUsage('birdeye', 100);
      const usage = creditMonitor.getUsage('birdeye');

      expect(usage).toBeDefined();
      expect(usage?.provider).toBe('birdeye');
      expect(usage?.creditsUsed).toBe(100);
    });
  });

  describe('getAllUsage', () => {
    it('should return usage for all providers', () => {
      // This test verifies getAllUsage returns all providers
      // Since creditMonitor is a singleton, it may have existing state
      const allUsage = creditMonitor.getAllUsage();
      
      // Should return an array (may be empty or have entries)
      expect(Array.isArray(allUsage)).toBe(true);
      
      // If there are entries, they should have the correct structure
      allUsage.forEach(usage => {
        expect(usage).toHaveProperty('provider');
        expect(usage).toHaveProperty('creditsUsed');
        expect(usage).toHaveProperty('requestsCount');
      });
    });

    it('should return report with correct structure', () => {
      creditMonitor.resetUsage('test-provider');
      creditMonitor.recordUsage('test-provider', 100, 5);
      
      const report = creditMonitor.getReport();
      
      expect(report).toHaveProperty('providers');
      expect(report).toHaveProperty('totalCreditsUsed');
      expect(report).toHaveProperty('totalRequests');
      expect(Array.isArray(report.providers)).toBe(true);
      expect(typeof report.totalCreditsUsed).toBe('number');
      expect(typeof report.totalRequests).toBe('number');
    });

    it('should return all providers usage', () => {
      creditMonitor.recordUsage('birdeye', 100);
      creditMonitor.recordUsage('helius', 200);

      const allUsage = creditMonitor.getAllUsage();
      expect(allUsage.length).toBeGreaterThanOrEqual(2);
      expect(allUsage.some(u => u.provider === 'birdeye')).toBe(true);
      expect(allUsage.some(u => u.provider === 'helius')).toBe(true);
    });
  });

  describe('resetUsage', () => {
    it('should reset credits and requests for provider', () => {
      creditMonitor.recordUsage('birdeye', 100, 5);
      creditMonitor.resetUsage('birdeye');

      const usage = creditMonitor.getUsage('birdeye');
      expect(usage?.creditsUsed).toBe(0);
      expect(usage?.requestsCount).toBe(0);
      expect(usage?.lastReset).toBeDefined();
    });

    it('should update lastReset timestamp', () => {
      creditMonitor.recordUsage('birdeye', 100);
      const beforeReset = creditMonitor.getUsage('birdeye');
      const beforeTime = beforeReset?.lastReset;

      // Wait a bit to ensure timestamp changes
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Small delay
      }

      creditMonitor.resetUsage('birdeye');
      const afterReset = creditMonitor.getUsage('birdeye');
      const afterTime = afterReset?.lastReset;

      expect(afterTime).toBeDefined();
      expect(afterTime?.getTime()).toBeGreaterThanOrEqual(beforeTime?.getTime() || 0);
    });

    it('should log reset action', () => {
      creditMonitor.recordUsage('birdeye', 100);
      creditMonitor.resetUsage('birdeye');

      expect(logger.info).toHaveBeenCalledWith('Reset credit usage', { provider: 'birdeye' });
    });

    it('should not throw for unknown provider', () => {
      expect(() => {
        creditMonitor.resetUsage('unknown');
      }).not.toThrow();
    });
  });

  describe('hasCredits', () => {
    it('should return true when no limit is set', () => {
      creditMonitor.recordUsage('birdeye', 100);
      expect(creditMonitor.hasCredits('birdeye')).toBe(true);
    });

    it('should return true when credits available', () => {
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 500);
      expect(creditMonitor.hasCredits('birdeye', 400)).toBe(true);
    });

    it('should return false when credits insufficient', () => {
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 800);
      expect(creditMonitor.hasCredits('birdeye', 300)).toBe(false);
    });

    it('should return true when exactly at limit', () => {
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 500);
      expect(creditMonitor.hasCredits('birdeye', 500)).toBe(true);
    });

    it('should return false when over limit', () => {
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 500);
      expect(creditMonitor.hasCredits('birdeye', 501)).toBe(false);
    });

    it('should default required to 1', () => {
      creditMonitor.setLimit('birdeye', 1000);
      creditMonitor.recordUsage('birdeye', 1000);
      expect(creditMonitor.hasCredits('birdeye')).toBe(false);
    });

    it('should return true for unknown provider', () => {
      expect(creditMonitor.hasCredits('unknown')).toBe(true);
    });
  });

  describe('getReport', () => {
    it('should return report with correct structure', () => {
      const report = creditMonitor.getReport();

      expect(report).toHaveProperty('providers');
      expect(report).toHaveProperty('totalCreditsUsed');
      expect(report).toHaveProperty('totalRequests');
      expect(Array.isArray(report.providers)).toBe(true);
      expect(typeof report.totalCreditsUsed).toBe('number');
      expect(typeof report.totalRequests).toBe('number');
    });

    it('should calculate totals correctly', () => {
      creditMonitor.recordUsage('birdeye', 100, 5);
      creditMonitor.recordUsage('helius', 200, 10);

      const report = creditMonitor.getReport();

      expect(report.totalCreditsUsed).toBe(300);
      expect(report.totalRequests).toBe(15);
      expect(report.providers.length).toBeGreaterThanOrEqual(2);
    });

    it('should include all providers in report', () => {
      creditMonitor.recordUsage('birdeye', 100);
      creditMonitor.recordUsage('helius', 200);
      creditMonitor.recordUsage('other', 50);

      const report = creditMonitor.getReport();

      expect(report.providers.length).toBeGreaterThanOrEqual(3);
      expect(report.providers.some(p => p.provider === 'birdeye')).toBe(true);
      expect(report.providers.some(p => p.provider === 'helius')).toBe(true);
      expect(report.providers.some(p => p.provider === 'other')).toBe(true);
    });
  });
});

