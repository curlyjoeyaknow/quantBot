/**
 * Metrics Aggregator Tests
 * ========================
 * Unit tests for MetricsAggregator
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsAggregator } from '@quantbot/analytics/aggregators/MetricsAggregator.js';
import type {
  CallPerformance,
  CallerMetrics,
  AthDistribution,
  SystemMetrics,
} from '@quantbot/analytics/types.js';

// Mock dependencies
const mockPool = {
  query: vi.fn(),
};

vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(() => mockPool),
}));

describe('MetricsAggregator', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    aggregator = new MetricsAggregator();
  });

  describe('aggregateCallerMetrics', () => {
    it('should aggregate metrics for a single caller', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 2,
          athMultiple: 2,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 3,
          athMultiple: 3,
          timeToAthMinutes: 120,
          atlPrice: 0.8,
          atlMultiple: 1.25,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        callerName: 'caller1',
        totalCalls: 2,
        winningCalls: 2,
        losingCalls: 0,
        winRate: 1,
        avgMultiple: 2.5,
        bestMultiple: 3,
        worstMultiple: 2,
        avgTimeToAth: 90,
      });
    });

    it('should aggregate metrics for multiple callers', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 2,
          athMultiple: 2,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 0.5,
          athMultiple: 0.5,
          timeToAthMinutes: 0,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);

      expect(result).toHaveLength(2);
      expect(result[0].totalCalls).toBeGreaterThanOrEqual(result[1].totalCalls); // Sorted by total calls
    });

    it('should handle winning and losing calls correctly', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 2,
          athMultiple: 2,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 0.5,
          athMultiple: 0.5,
          timeToAthMinutes: 0,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 3,
          tokenAddress: 'token3',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);

      expect(result[0]).toMatchObject({
        callerName: 'caller1',
        totalCalls: 3,
        winningCalls: 1,
        losingCalls: 2,
        winRate: 1 / 3,
      });
    });

    it('should handle empty calls array', () => {
      const result = aggregator.aggregateCallerMetrics([]);
      expect(result).toHaveLength(0);
    });

    it('should calculate correct averages', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1.5,
          timeToAthMinutes: 30,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 2.5,
          timeToAthMinutes: 90,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);

      expect(result[0].avgMultiple).toBe(2);
      expect(result[0].avgTimeToAth).toBe(60);
    });

    it('should handle calls with zero timeToAth', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 2,
          timeToAthMinutes: 0,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 3,
          timeToAthMinutes: 120,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);

      expect(result[0].avgTimeToAth).toBe(120); // Only non-zero times counted
    });
  });

  describe('calculateAthDistribution', () => {
    it('should calculate distribution for calls in different buckets', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 0.5, // Loss
          timeToAthMinutes: 0,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1.2, // 1.0-1.5x
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 3,
          tokenAddress: 'token3',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 3, // 2-5x
          timeToAthMinutes: 120,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 4,
          tokenAddress: 'token4',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-04'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 15, // 10-20x
          timeToAthMinutes: 180,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = aggregator.calculateAthDistribution(calls);

      expect(result).toHaveLength(8); // 8 buckets
      const lossBucket = result.find((b) => b.bucket === 'Loss (<1x)');
      expect(lossBucket?.count).toBe(1);
      expect(lossBucket?.percentage).toBe(25);

      const bucket1_5 = result.find((b) => b.bucket === '1.0-1.5x');
      expect(bucket1_5?.count).toBe(1);
      expect(bucket1_5?.percentage).toBe(25);

      const bucket2_5 = result.find((b) => b.bucket === '2-5x');
      expect(bucket2_5?.count).toBe(1);
      expect(bucket2_5?.percentage).toBe(25);

      const bucket10_20 = result.find((b) => b.bucket === '10-20x');
      expect(bucket10_20?.count).toBe(1);
      expect(bucket10_20?.percentage).toBe(25);
    });

    it('should handle empty calls array', () => {
      const result = aggregator.calculateAthDistribution([]);
      expect(result).toHaveLength(8);
      expect(result.every((b) => b.count === 0 && b.percentage === 0)).toBe(true);
    });

    it('should calculate average time to ATH per bucket', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1.2,
          timeToAthMinutes: 30,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1.3,
          timeToAthMinutes: 90,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = aggregator.calculateAthDistribution(calls);
      const bucket = result.find((b) => b.bucket === '1.0-1.5x');
      expect(bucket?.avgTimeToAth).toBe(60); // (30 + 90) / 2
    });
  });

  describe('calculateSystemMetrics', () => {
    it('should calculate system metrics from database', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '100' }] }) // totalCalls
        .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // totalCallers
        .mockResolvedValueOnce({ rows: [{ count: '50' }] }) // totalTokens
        .mockResolvedValueOnce({ rows: [{ count: '200' }] }) // simulationsTotal
        .mockResolvedValueOnce({ rows: [{ count: '5' }] }); // simulationsToday

      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 2,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-10'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 3,
          timeToAthMinutes: 120,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = await aggregator.calculateSystemMetrics(calls);

      expect(result).toMatchObject({
        totalCalls: 100,
        totalCallers: 10,
        totalTokens: 50,
        simulationsTotal: 200,
        simulationsToday: 5,
      });
      expect(result.dataRange.start).toBeInstanceOf(Date);
      expect(result.dataRange.end).toBeInstanceOf(Date);
    });

    it('should handle database errors gracefully', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const calls: CallPerformance[] = [];

      await expect(aggregator.calculateSystemMetrics(calls)).rejects.toThrow('Database error');
    });

    it('should handle empty calls array for date range', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });

      const result = await aggregator.calculateSystemMetrics([]);

      expect(result.dataRange.start).toBeInstanceOf(Date);
      expect(result.dataRange.end).toBeInstanceOf(Date);
    });
  });
});
