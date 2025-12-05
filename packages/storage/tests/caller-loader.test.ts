import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallerDataLoader } from '../../src/data/loaders/caller-loader';
import { callerDatabase } from '../../src/storage/caller-database';

// Mock caller database
vi.mock('../../src/storage/caller-database', () => ({
  callerDatabase: {
    getCallerAlerts: vi.fn(),
    getCallerAlertsInRange: vi.fn(),
  },
}));

describe('caller-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CallerDataLoader', () => {
    it('should have correct name', () => {
      const loader = new CallerDataLoader();
      expect(loader.name).toBe('caller-loader');
    });

    it('should throw error when caller is missing', async () => {
      const loader = new CallerDataLoader();
      await expect(loader.load({ source: 'caller' } as any)).rejects.toThrow(
        'Caller loader requires a caller name',
      );
    });

    it('should load caller alerts', async () => {
      const mockAlerts = [
        {
          tokenAddress: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01T00:00:00Z'),
          callerName: 'test-caller',
          tokenSymbol: 'SOL',
          priceAtAlert: 1.0,
          volumeAtAlert: 1000,
        },
      ];

      vi.mocked(callerDatabase.getCallerAlerts).mockResolvedValue(mockAlerts as any);

      const loader = new CallerDataLoader();
      const results = await loader.load({
        source: 'caller',
        caller: 'test-caller',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(callerDatabase.getCallerAlerts).toHaveBeenCalledWith('test-caller', 100);
    });

    it('should use custom limit', async () => {
      vi.mocked(callerDatabase.getCallerAlerts).mockResolvedValue([]);

      const loader = new CallerDataLoader();
      await loader.load({
        source: 'caller',
        caller: 'test-caller',
        limit: 50,
      });

      expect(callerDatabase.getCallerAlerts).toHaveBeenCalledWith('test-caller', 50);
    });

    it('should load alerts in date range', async () => {
      const mockAlerts = [
        {
          tokenAddress: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01T00:00:00Z'),
          callerName: 'test-caller',
        },
      ];

      vi.mocked(callerDatabase.getCallerAlertsInRange).mockResolvedValue(mockAlerts as any);

      const loader = new CallerDataLoader();
      const results = await loader.load({
        source: 'caller',
        caller: 'test-caller',
        lookbackDays: 7,
      });

      expect(callerDatabase.getCallerAlertsInRange).toHaveBeenCalled();
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('should use default chain when not provided', async () => {
      vi.mocked(callerDatabase.getCallerAlerts).mockResolvedValue([]);

      const loader = new CallerDataLoader();
      await loader.load({
        source: 'caller',
        caller: 'test-caller',
      });

      // Should use default chain 'solana'
      expect(callerDatabase.getCallerAlerts).toHaveBeenCalled();
    });

    it('should check canLoad correctly', () => {
      const loader = new CallerDataLoader();
      expect(loader.canLoad('caller')).toBe(true);
      expect(loader.canLoad('caller:test')).toBe(true);
      expect(loader.canLoad('csv')).toBe(false);
    });
  });
});


