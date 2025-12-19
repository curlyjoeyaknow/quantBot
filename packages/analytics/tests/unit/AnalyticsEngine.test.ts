/**
 * Analytics Engine Tests
 * ======================
 * Unit tests for AnalyticsEngine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalyticsEngine } from '@quantbot/analytics/engine/AnalyticsEngine.js';
import { CallDataLoader } from '@quantbot/analytics/loaders/CallDataLoader.js';
import { MetricsAggregator } from '@quantbot/analytics/aggregators/MetricsAggregator.js';
import type { CallPerformance } from '@quantbot/analytics/types.js';

// Mock dependencies
const mockCallLoaderInstance = {
  loadCalls: vi.fn(),
  enrichWithAth: vi.fn(),
};

const mockAggregatorInstance = {
  aggregateCallerMetrics: vi.fn(),
  calculateAthDistribution: vi.fn(),
  calculateSystemMetrics: vi.fn(),
};

vi.mock('@quantbot/analytics/loaders/CallDataLoader.js', () => ({
  CallDataLoader: class {
    constructor() {
      return mockCallLoaderInstance;
    }
  },
}));

vi.mock('@quantbot/analytics/aggregators/MetricsAggregator.js', () => ({
  MetricsAggregator: class {
    constructor() {
      return mockAggregatorInstance;
    }
  },
}));
vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
}));

describe('AnalyticsEngine', () => {
  let engine: AnalyticsEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCallLoaderInstance.loadCalls.mockReset();
    mockCallLoaderInstance.enrichWithAth.mockReset();
    mockAggregatorInstance.aggregateCallerMetrics.mockReset();
    mockAggregatorInstance.calculateAthDistribution.mockReset();
    mockAggregatorInstance.calculateSystemMetrics.mockReset();

    engine = new AnalyticsEngine();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(engine.initialize()).resolves.not.toThrow();
    });

    it('should not initialize twice', async () => {
      await engine.initialize();
      await engine.initialize(); // Should not throw
      expect(true).toBe(true); // If we get here, it worked
    });
  });

  describe('analyzeCalls', () => {
    const mockCalls: CallPerformance[] = [
      {
        callId: 1,
        tokenAddress: 'test123',
        callerName: 'test_caller',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1.0,
        athPrice: 2.0,
        athMultiple: 2.0,
        timeToAthMinutes: 60,
      },
    ];

    beforeEach(() => {
      mockCallLoaderInstance.loadCalls.mockResolvedValue(mockCalls);
      mockCallLoaderInstance.enrichWithAth.mockResolvedValue(mockCalls);
      mockAggregatorInstance.aggregateCallerMetrics.mockReturnValue([]);
      mockAggregatorInstance.calculateAthDistribution.mockReturnValue([]);
      mockAggregatorInstance.calculateSystemMetrics.mockResolvedValue({
        totalCalls: 1,
        totalCallers: 1,
        totalTokens: 1,
        dataRange: { start: new Date(), end: new Date() },
        simulationsToday: 0,
        simulationsTotal: 0,
      });
    });

    it('should analyze calls successfully', async () => {
      const result = await engine.analyzeCalls();

      expect(result).toBeDefined();
      expect(result.calls).toEqual(mockCalls);
      expect(mockCallLoaderInstance.loadCalls).toHaveBeenCalled();
    });

    it('should filter by caller names', async () => {
      await engine.analyzeCalls({ callerNames: ['test_caller'] });

      expect(mockCallLoaderInstance.loadCalls).toHaveBeenCalledWith(
        expect.objectContaining({ callerNames: ['test_caller'] })
      );
    });

    it('should filter by date range', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');

      await engine.analyzeCalls({ from, to });

      expect(mockCallLoaderInstance.loadCalls).toHaveBeenCalledWith(
        expect.objectContaining({ from, to })
      );
    });

    it('should enrich with ATH when requested', async () => {
      await engine.analyzeCalls({ enrichWithAth: true });

      expect(mockCallLoaderInstance.enrichWithAth).toHaveBeenCalled();
    });

    it('should not enrich with ATH when not requested', async () => {
      await engine.analyzeCalls({ enrichWithAth: false });

      expect(mockCallLoaderInstance.enrichWithAth).not.toHaveBeenCalled();
    });
  });

  describe('getCallerMetrics', () => {
    const mockCalls: CallPerformance[] = [
      {
        callId: 1,
        tokenAddress: 'test123',
        callerName: 'test_caller',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1.0,
        athPrice: 2.0,
        athMultiple: 2.0,
        timeToAthMinutes: 60,
      },
    ];

    beforeEach(() => {
      mockCallLoaderInstance.loadCalls.mockResolvedValue(mockCalls);
      mockAggregatorInstance.aggregateCallerMetrics.mockReturnValue([]);
      mockAggregatorInstance.calculateSystemMetrics.mockResolvedValue({
        totalCalls: 1,
        totalCallers: 1,
        totalTokens: 1,
        dataRange: { start: new Date(), end: new Date() },
        simulationsToday: 0,
        simulationsTotal: 0,
      });
    });

    it('should get metrics for a specific caller', async () => {
      const mockMetrics = {
        callerName: 'test_caller',
        totalCalls: 10,
        winningCalls: 5,
        losingCalls: 5,
        winRate: 0.5,
        avgMultiple: 1.5,
        bestMultiple: 5.0,
        worstMultiple: 0.5,
        avgTimeToAth: 120,
        firstCall: new Date(),
        lastCall: new Date(),
      };

      mockAggregatorInstance.aggregateCallerMetrics.mockReturnValue([mockMetrics]);

      const result = await engine.getCallerMetrics('test_caller');

      expect(result).toEqual(mockMetrics);
    });

    it('should return null for non-existent caller', async () => {
      mockAggregatorInstance.aggregateCallerMetrics.mockReturnValue([]);

      const result = await engine.getCallerMetrics('non_existent');

      expect(result).toBeNull();
    });
  });
});
