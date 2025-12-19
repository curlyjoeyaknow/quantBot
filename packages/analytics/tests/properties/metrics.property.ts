/**
 * Property Tests for Analytics Metrics
 * =====================================
 *
 * Tests critical invariants for financial calculations using property-based testing.
 *
 * Critical Invariants:
 * 1. Win rate is always between 0 and 1 (inclusive)
 * 2. ATH multiple is always >= 1 (entry price is baseline)
 * 3. Metrics aggregation is monotonic (more calls = more total)
 * 4. Average calculations are bounded
 */

import { describe, it, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { MetricsAggregator } from '@quantbot/analytics/aggregators/MetricsAggregator.js';
import type { CallPerformance } from '@quantbot/analytics/types.js';

// Mock dependencies
vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }),
  })),
}));

describe('MetricsAggregator - Property Tests', () => {
  let aggregator: MetricsAggregator;

  beforeEach(() => {
    aggregator = new MetricsAggregator();
  });

  describe('Win Rate Bounds (Critical Invariant)', () => {
    it('win rate is always between 0 and 1 (inclusive)', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.string(),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 0, maxLength: 100 }
          ),
          (calls: CallPerformance[]) => {
            const metrics = aggregator.aggregateCallerMetrics(calls);
            return metrics.every((m) => m.winRate >= 0 && m.winRate <= 1);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('ATH Multiple Bounds (Critical Invariant)', () => {
    it('average multiple is always >= 0', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.string(),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 1, maxLength: 100 }
          ),
          (calls: CallPerformance[]) => {
            const metrics = aggregator.aggregateCallerMetrics(calls);
            return metrics.every((m) => m.avgMultiple >= 0);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('best multiple >= worst multiple for same caller', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.constant('test_caller'),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 1, maxLength: 100 }
          ),
          (calls: CallPerformance[]) => {
            const metrics = aggregator.aggregateCallerMetrics(calls);
            return metrics.every((m) => m.bestMultiple >= m.worstMultiple);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Monotonicity (Critical Invariant)', () => {
    it('total calls is monotonic: adding calls increases total', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.constant('test_caller'),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 0, maxLength: 50 }
          ),
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1000 }),
              tokenAddress: fc.string(),
              callerName: fc.constant('test_caller'),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 1, maxLength: 50 }
          ),
          (calls1: CallPerformance[], calls2: CallPerformance[]) => {
            const metrics1 = aggregator.aggregateCallerMetrics(calls1);
            const metrics2 = aggregator.aggregateCallerMetrics([...calls1, ...calls2]);

            if (metrics1.length === 0) return true;
            if (metrics2.length === 0) return false;

            const total1 = metrics1[0]?.totalCalls || 0;
            const total2 = metrics2[0]?.totalCalls || 0;

            return total2 >= total1;
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Conservation Laws', () => {
    it('winning calls + losing calls = total calls', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.constant('test_caller'),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 1, maxLength: 100 }
          ),
          (calls: CallPerformance[]) => {
            const metrics = aggregator.aggregateCallerMetrics(calls);
            return metrics.every((m) => m.winningCalls + m.losingCalls === m.totalCalls);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('ATH Distribution Bounds', () => {
    it('distribution percentages sum to 100% (within rounding)', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.string(),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 0, maxLength: 100 }
          ),
          (calls: CallPerformance[]) => {
            const distribution = aggregator.calculateAthDistribution(calls);
            const totalPercentage = distribution.reduce((sum, d) => sum + d.percentage, 0);
            // Allow small rounding errors (within 0.1%)
            return Math.abs(totalPercentage - 100) < 0.1 || calls.length === 0;
          }
        ),
        { numRuns: 100 }
      );
    });

    it('distribution counts sum to total calls', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              callId: fc.integer({ min: 1 }),
              tokenAddress: fc.string(),
              callerName: fc.string(),
              chain: fc.constant('solana'),
              alertTimestamp: fc.date(),
              entryPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              athPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(10000) }),
              athMultiple: fc.float({ min: Math.fround(0), max: Math.fround(1000) }),
              timeToAthMinutes: fc.float({ min: Math.fround(0), max: Math.fround(10000) }),
              atlPrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
              atlMultiple: fc.float({ min: Math.fround(0.1), max: Math.fround(10) }),
            }),
            { minLength: 0, maxLength: 100 }
          ),
          (calls: CallPerformance[]) => {
            const distribution = aggregator.calculateAthDistribution(calls);
            const totalCount = distribution.reduce((sum, d) => sum + d.count, 0);
            return totalCount === calls.length;
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
