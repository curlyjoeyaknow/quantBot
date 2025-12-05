import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CallerTrackingService, ProcessedCADrop } from '../../src/services/caller-tracking';
import { callerDatabase } from '../../src/storage/caller-database';

// Mock dependencies
vi.mock('../../src/storage/caller-database', () => ({
  callerDatabase: {
    addCallerAlertsBatch: vi.fn(),
    getCallerAlerts: vi.fn(),
    getCallerAlertsInRange: vi.fn(),
    getAllCallers: vi.fn(),
    getAllCallerStats: vi.fn(),
    getCallerStats: vi.fn(),
    getTopCallers: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

describe('caller-tracking', () => {
  let service: CallerTrackingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CallerTrackingService();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await service.initialize();
      // Should not throw
    });
  });

  describe('processCADrops', () => {
    it('should process and store CA drops', async () => {
      const caDrops: ProcessedCADrop[] = [
        {
          sender: 'caller1',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          tokenSymbol: 'TEST',
          chain: 'solana',
          timestamp: new Date(),
          message: 'Check this out',
          priceAtAlert: 0.001,
          volumeAtAlert: 1000,
        },
        {
          sender: 'caller2',
          tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          chain: 'solana',
          timestamp: new Date(),
        },
      ];

      vi.mocked(callerDatabase.addCallerAlertsBatch).mockResolvedValue(2);

      const result = await service.processCADrops(caDrops);

      expect(result).toBe(2);
      expect(callerDatabase.addCallerAlertsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            callerName: 'caller1',
            tokenAddress: 'So11111111111111111111111111111111111111112',
            tokenSymbol: 'TEST',
            chain: 'solana',
            priceAtAlert: 0.001,
            volumeAtAlert: 1000,
          }),
        ])
      );
    });

    it('should handle empty array', async () => {
      vi.mocked(callerDatabase.addCallerAlertsBatch).mockResolvedValue(0);

      const result = await service.processCADrops([]);

      expect(result).toBe(0);
      expect(callerDatabase.addCallerAlertsBatch).toHaveBeenCalledWith([]);
    });

    it('should handle errors', async () => {
      const caDrops: ProcessedCADrop[] = [
        {
          sender: 'caller1',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          timestamp: new Date(),
        },
      ];

      vi.mocked(callerDatabase.addCallerAlertsBatch).mockRejectedValue(new Error('Database error'));

      await expect(service.processCADrops(caDrops)).rejects.toThrow('Database error');
    });
  });

  describe('getCallerAlerts', () => {
    it('should get alerts for a caller', async () => {
      const mockAlerts = [
        {
          id: 1,
          callerName: 'caller1',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          tokenSymbol: 'TEST',
          chain: 'solana',
          alertTimestamp: new Date(),
          alertMessage: 'Check this',
          priceAtAlert: 0.001,
          volumeAtAlert: 1000,
          createdAt: new Date(),
        },
      ];

      vi.mocked(callerDatabase.getCallerAlerts).mockResolvedValue(mockAlerts as any);

      const result = await service.getCallerAlerts('caller1');

      expect(result).toEqual(mockAlerts);
      expect(callerDatabase.getCallerAlerts).toHaveBeenCalledWith('caller1', undefined);
    });

    it('should get alerts with limit', async () => {
      vi.mocked(callerDatabase.getCallerAlerts).mockResolvedValue([]);

      await service.getCallerAlerts('caller1', 10);

      expect(callerDatabase.getCallerAlerts).toHaveBeenCalledWith('caller1', 10);
    });

    it('should handle errors', async () => {
      vi.mocked(callerDatabase.getCallerAlerts).mockRejectedValue(new Error('Database error'));

      await expect(service.getCallerAlerts('caller1')).rejects.toThrow('Database error');
    });
  });

  describe('getCallerAlertsInRange', () => {
    it('should get alerts in time range', async () => {
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-31');
      const mockAlerts = [
        {
          id: 1,
          callerName: 'caller1',
          tokenAddress: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-15'),
          createdAt: new Date(),
        },
      ];

      vi.mocked(callerDatabase.getCallerAlertsInRange).mockResolvedValue(mockAlerts as any);

      const result = await service.getCallerAlertsInRange('caller1', startTime, endTime);

      expect(result).toEqual(mockAlerts);
      expect(callerDatabase.getCallerAlertsInRange).toHaveBeenCalledWith('caller1', startTime, endTime);
    });

    it('should handle errors', async () => {
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-31');

      vi.mocked(callerDatabase.getCallerAlertsInRange).mockRejectedValue(new Error('Database error'));

      await expect(service.getCallerAlertsInRange('caller1', startTime, endTime)).rejects.toThrow('Database error');
    });
  });

  describe('getAllCallersWithStats', () => {
    it('should get all callers with statistics', async () => {
      const mockCallers = ['caller1', 'caller2'];
      const mockStats = [
        { callerName: 'caller1', totalAlerts: 10, uniqueTokens: 5 },
        { callerName: 'caller2', totalAlerts: 5, uniqueTokens: 3 },
      ];

      vi.mocked(callerDatabase.getAllCallers).mockResolvedValue(mockCallers);
      vi.mocked(callerDatabase.getAllCallerStats).mockResolvedValue(mockStats as any);

      const result = await service.getAllCallersWithStats();

      expect(result).toEqual([
        { callerName: 'caller1', stats: mockStats[0] },
        { callerName: 'caller2', stats: mockStats[1] },
      ]);
    });

    it('should handle empty callers list', async () => {
      vi.mocked(callerDatabase.getAllCallers).mockResolvedValue([]);
      vi.mocked(callerDatabase.getAllCallerStats).mockResolvedValue([]);

      const result = await service.getAllCallersWithStats();

      expect(result).toEqual([]);
    });
  });


  describe('getTopCallers', () => {
    it('should get top callers by alert count', async () => {
      const mockStats = [
        { callerName: 'caller1', totalAlerts: 10, uniqueTokens: 5 },
        { callerName: 'caller2', totalAlerts: 5, uniqueTokens: 3 },
      ];

      vi.mocked(callerDatabase.getAllCallerStats).mockResolvedValue(mockStats as any);

      const result = await service.getTopCallers(10);

      expect(result).toEqual([
        { callerName: 'caller1', alertCount: 10, uniqueTokens: 5 },
        { callerName: 'caller2', alertCount: 5, uniqueTokens: 3 },
      ]);
      expect(callerDatabase.getAllCallerStats).toHaveBeenCalled();
    });
  });
});

