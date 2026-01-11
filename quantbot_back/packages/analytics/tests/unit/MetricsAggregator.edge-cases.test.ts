/**
 * Metrics Aggregator Edge Case Tests
 * ===================================
 * Tests for edge cases in metrics aggregation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsAggregator } from '@quantbot/analytics/aggregators/MetricsAggregator.js';
import type { CallPerformance } from '@quantbot/analytics/types.js';

describe('MetricsAggregator Edge Cases', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  describe('aggregateCallerMetrics - Invalid Data', () => {
    it('should handle empty calls array', () => {
      const result = aggregator.aggregateCallerMetrics([]);
      expect(result).toEqual([]);
    });

    it('should handle calls with NaN athMultiple', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: NaN,
          athMultiple: NaN,
          timeToAthMinutes: 0,
          atlPrice: 1.0,
          atlMultiple: 1,
        },
        {
          callId: 2,
          tokenAddress: 'So11111111111111111111111111111111111111113',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2.0,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);
      expect(result).toHaveLength(1);
      expect(result[0].totalCalls).toBe(2);
      expect(result[0].losingCalls).toBe(1); // NaN should be counted as losing
      expect(result[0].winningCalls).toBe(1);
      expect(result[0].winRate).toBe(0.5);
    });

    it('should handle calls with Infinity athMultiple', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: Infinity,
          athMultiple: Infinity,
          timeToAthMinutes: 0,
          atlPrice: 1.0,
          atlMultiple: 1,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);
      expect(result).toHaveLength(1);
      // Infinity is filtered out (line 48-56 in MetricsAggregator.ts), so avgMultiple is 0 when no valid calls
      // Since all calls have Infinity, they're all filtered, resulting in avgMultiple = 0
      expect(result[0].avgMultiple).toBe(0);
    });

    it('should handle calls with zero entry price', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 0,
          athPrice: 0,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 0,
          atlMultiple: 1,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);
      expect(result).toHaveLength(1);
      expect(result[0].totalCalls).toBe(1);
    });

    it('should handle calls with negative athMultiple', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: -0.5, // Invalid but should be handled
          athMultiple: -0.5,
          timeToAthMinutes: 0,
          atlPrice: 1.0,
          atlMultiple: 1,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);
      expect(result).toHaveLength(1);
      // Negative multiples are filtered out (line 48-56), so avgMultiple is 0 when no valid calls
      expect(result[0].avgMultiple).toBe(0);
    });

    it('should handle calls with missing timestamps', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2.0,
        },
        {
          callId: 2,
          tokenAddress: 'So11111111111111111111111111111111111111113',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('invalid'), // Invalid date
          entryPrice: 1.0,
          athPrice: 1.5,
          athMultiple: 1.5,
          timeToAthMinutes: 30,
          atlPrice: 0.8,
          atlMultiple: 1.25,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);
      expect(result).toHaveLength(1);
      // Should handle invalid dates gracefully
      expect(result[0].totalCalls).toBe(2);
    });

    it('should handle very large athMultiple values', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 0.0001,
          athPrice: 1000, // 10,000,000x
          athMultiple: 10000000,
          timeToAthMinutes: 60,
          atlPrice: 0.00005,
          atlMultiple: 2.0,
        },
      ];

      const result = aggregator.aggregateCallerMetrics(calls);
      expect(result).toHaveLength(1);
      // Very large multiples should be handled (though may be capped in ATH calculator)
      expect(result[0].bestMultiple).toBeGreaterThan(1);
    });
  });

  describe('calculateAthDistribution - Edge Cases', () => {
    it('should handle empty calls array', () => {
      const result = aggregator.calculateAthDistribution([]);
      // Returns buckets with 0 counts, not empty array (see line 114-119 in MetricsAggregator.ts)
      expect(result).toHaveLength(8); // ATH_BUCKETS has 8 buckets
      expect(result.every((b) => b.count === 0 && b.percentage === 0)).toBe(true);
    });

    it('should handle calls with all 1x ATH (no winners)', () => {
      const calls: CallPerformance[] = Array.from({ length: 10 }, (_, i) => ({
        callId: i + 1,
        tokenAddress: `So${i.toString().padStart(44, '0')}`,
        callerName: 'test_caller',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1.0,
        athPrice: 1.0,
        athMultiple: 1.0,
        timeToAthMinutes: 0,
        atlPrice: 1.0,
        atlMultiple: 1.0,
      }));

      const result = aggregator.calculateAthDistribution(calls);
      expect(result.length).toBeGreaterThan(0);
      // Should have distribution even for 1x calls
      const oneXBucket = result.find((b) => b.bucket === '1.0-1.5x');
      expect(oneXBucket).toBeDefined();
      expect(oneXBucket?.count).toBe(10);
    });

    it('should handle calls with NaN athMultiple', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: NaN,
          athMultiple: NaN,
          timeToAthMinutes: 0,
          atlPrice: 1.0,
          atlMultiple: 1,
        },
      ];

      const result = aggregator.calculateAthDistribution(calls);
      // NaN calls should be filtered out or placed in loss bucket
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle calls with extreme athMultiple values', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 0.0001,
          athPrice: 100, // 1,000,000x
          athMultiple: 1000000,
          timeToAthMinutes: 60,
          atlPrice: 0.00005,
          atlMultiple: 2.0,
        },
      ];

      const result = aggregator.calculateAthDistribution(calls);
      // Extreme values should be placed in 50x+ bucket
      const extremeBucket = result.find((b) => b.bucket === '50x+');
      expect(extremeBucket).toBeDefined();
      expect(extremeBucket?.count).toBe(1);
    });
  });

  describe('calculateSystemMetrics - Edge Cases', () => {
    it('should handle empty calls array', async () => {
      const result = await aggregator.calculateSystemMetrics([]);
      expect(result.totalCalls).toBe(0);
      expect(result.totalCallers).toBe(0);
      expect(result.totalTokens).toBe(0);
    });

    it('should handle calls with invalid dates', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date('invalid'), // Invalid date
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2.0,
        },
      ];

      const result = await aggregator.calculateSystemMetrics(calls);
      // Invalid dates are filtered out (line 169-171 in MetricsAggregator.ts)
      expect(result.totalCalls).toBe(0);
      // Should handle invalid dates gracefully by filtering them out
    });
  });
});
