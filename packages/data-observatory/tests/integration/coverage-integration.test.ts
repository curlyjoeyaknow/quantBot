/**
 * Integration Tests for Coverage Calculation
 *
 * Tests coverage calculation with real data.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DateTime } from 'luxon';
import { CoverageCalculator } from '../../src/quality/coverage.js';
import type { CanonicalEvent } from '../../src/canonical/schemas.js';

describe('Coverage Calculation Integration Tests', () => {
  let coverageCalculator: CoverageCalculator;

  beforeAll(() => {
    coverageCalculator = new CoverageCalculator();
  });

  describe('Token Coverage Calculation', () => {
    it('should calculate coverage for complete data', () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const from = DateTime.fromISO('2024-01-01T00:00:00Z');
      const to = DateTime.fromISO('2024-01-01T01:00:00Z'); // 1 hour

      // Create events every 5 minutes (12 events)
      const events: CanonicalEvent[] = [];
      for (let i = 0; i < 12; i++) {
        const timestamp = from.plus({ minutes: i * 5 });
        events.push({
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: timestamp.toISO()!,
          eventType: 'candle',
          value: {
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            volume: 1000,
            interval: '5m',
          },
          isMissing: false,
        });
      }

      const coverage = coverageCalculator.calculateTokenCoverage(
        tokenAddress,
        'solana',
        events,
        from,
        to,
        5 // 5-minute intervals
      );

      // Should have 100% coverage (12 events / 12 expected)
      expect(coverage.tokenAddress).toBe(tokenAddress);
      expect(coverage.chain).toBe('solana');
      expect(coverage.expectedCount).toBe(12);
      expect(coverage.actualCount).toBe(12);
      expect(coverage.completeness).toBe(100);
      expect(coverage.gaps.length).toBe(0);
    });

    it('should detect gaps in data', () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const from = DateTime.fromISO('2024-01-01T00:00:00Z');
      const to = DateTime.fromISO('2024-01-01T01:00:00Z'); // 1 hour

      // Create events with gaps (missing middle 20 minutes)
      const events: CanonicalEvent[] = [
        {
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: from.toISO()!,
          eventType: 'candle',
          value: { open: 100, high: 101, low: 99, close: 100.5, volume: 1000, interval: '5m' },
          isMissing: false,
        },
        {
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: from.plus({ minutes: 5 }).toISO()!,
          eventType: 'candle',
          value: { open: 100, high: 101, low: 99, close: 100.5, volume: 1000, interval: '5m' },
          isMissing: false,
        },
        // Gap: missing 10-30 minutes
        {
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: from.plus({ minutes: 30 }).toISO()!,
          eventType: 'candle',
          value: { open: 100, high: 101, low: 99, close: 100.5, volume: 1000, interval: '5m' },
          isMissing: false,
        },
      ];

      const coverage = coverageCalculator.calculateTokenCoverage(
        tokenAddress,
        'solana',
        events,
        from,
        to,
        5
      );

      // Should detect gaps
      expect(coverage.gaps.length).toBeGreaterThan(0);
      expect(coverage.completeness).toBeLessThan(100);
    });

    it('should detect anomalies', () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const from = DateTime.fromISO('2024-01-01T00:00:00Z');
      const to = DateTime.fromISO('2024-01-01T01:00:00Z');

      // Create events with anomalies
      const events: CanonicalEvent[] = [
        {
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: from.toISO()!,
          eventType: 'candle',
          value: { open: 100, high: 101, low: 99, close: 100.5, volume: 1000, interval: '5m' },
          isMissing: false,
        },
        {
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: from.toISO()!, // Duplicate timestamp
          eventType: 'candle',
          value: { open: 100, high: 101, low: 99, close: 100.5, volume: 1000, interval: '5m' },
          isMissing: false,
        },
        {
          asset: tokenAddress,
          chain: 'solana',
          venue: 'birdeye',
          timestamp: from.plus({ minutes: 5 }).toISO()!,
          eventType: 'candle',
          value: null as any, // Null value
          isMissing: true,
        },
      ];

      const coverage = coverageCalculator.calculateTokenCoverage(
        tokenAddress,
        'solana',
        events,
        from,
        to,
        5
      );

      // Should detect anomalies
      expect(coverage.anomalies.length).toBeGreaterThan(0);
      expect(coverage.anomalies.some((a) => a.includes('Duplicate'))).toBe(true);
      expect(coverage.anomalies.some((a) => a.includes('missing'))).toBe(true);
    });
  });

  describe('Aggregate Coverage', () => {
    it('should calculate aggregate coverage across multiple tokens', () => {
      const from = DateTime.fromISO('2024-01-01T00:00:00Z');
      const to = DateTime.fromISO('2024-01-01T01:00:00Z');

      const coverages = [
        {
          tokenAddress: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          from,
          to,
          expectedCount: 12,
          actualCount: 12,
          completeness: 100,
          gaps: [] as any[],
          anomalies: [] as string[],
        },
        {
          tokenAddress: 'Token22222222222222222222222222222222222222222',
          chain: 'solana',
          from,
          to,
          expectedCount: 12,
          actualCount: 6,
          completeness: 50,
          gaps: [] as any[],
          anomalies: [] as string[],
        },
        {
          tokenAddress: 'Token33333333333333333333333333333333333333333',
          chain: 'solana',
          from,
          to,
          expectedCount: 12,
          actualCount: 0,
          completeness: 0,
          gaps: [] as any[],
          anomalies: [] as string[],
        },
      ];

      const aggregate = coverageCalculator.calculateAggregateCoverage(coverages);

      expect(aggregate.totalTokens).toBe(3);
      expect(aggregate.averageCompleteness).toBeCloseTo(50, 1); // (100 + 50 + 0) / 3
      expect(aggregate.tokensWithFullCoverage).toBe(1);
      expect(aggregate.tokensWithPartialCoverage).toBe(1);
      expect(aggregate.tokensWithNoCoverage).toBe(1);
    });

    it('should handle empty coverage array', () => {
      const aggregate = coverageCalculator.calculateAggregateCoverage([]);

      expect(aggregate.totalTokens).toBe(0);
      expect(aggregate.averageCompleteness).toBe(0);
      expect(aggregate.tokensWithFullCoverage).toBe(0);
      expect(aggregate.tokensWithPartialCoverage).toBe(0);
      expect(aggregate.tokensWithNoCoverage).toBe(0);
    });
  });
});

