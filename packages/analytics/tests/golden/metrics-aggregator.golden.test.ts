/**
 * Golden Tests for Metrics Aggregator
 * ====================================
 *
 * Known-answer tests for PnL and metrics calculations.
 * These tests verify exact mathematical correctness of financial calculations.
 *
 * Golden Path:
 * 1. Win rate calculation (winning calls / total calls)
 * 2. Average multiple calculation (sum of multiples / count)
 * 3. ATH distribution bucketing
 * 4. Edge cases (empty calls, NaN values, all wins, all losses)
 */

import { describe, it, expect } from 'vitest';
import { MetricsAggregator } from '../../src/aggregators/MetricsAggregator.js';
import type { CallPerformance } from '../../src/types.js';

describe('MetricsAggregator - Golden Tests', () => {
  const aggregator = new MetricsAggregator();

  describe('Win Rate Calculation', () => {
    it('GOLDEN: should calculate win rate correctly for mixed results', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'TestCaller',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 2.0, // Win
          atlMultiple: 0.8,
          timeToAthMinutes: 60,
        },
        {
          callerName: 'TestCaller',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 0.5, // Loss
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        {
          callerName: 'TestCaller',
          mint: 'Mint3',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          athMultiple: 1.5, // Win
          atlMultiple: 0.9,
          timeToAthMinutes: 120,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.callerName).toBe('TestCaller');
      expect(metrics[0]!.totalCalls).toBe(3);
      expect(metrics[0]!.winningCalls).toBe(2);
      expect(metrics[0]!.losingCalls).toBe(1);
      // Win rate: 2 wins / 3 total = 0.666...
      expect(metrics[0]!.winRate).toBeCloseTo(2 / 3, 10);
    });

    it('GOLDEN: should handle all wins correctly', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'PerfectCaller',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 2.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 60,
        },
        {
          callerName: 'PerfectCaller',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 3.0,
          atlMultiple: 1.5,
          timeToAthMinutes: 30,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      expect(metrics[0]!.winRate).toBe(1.0);
      expect(metrics[0]!.winningCalls).toBe(2);
      expect(metrics[0]!.losingCalls).toBe(0);
    });

    it('GOLDEN: should handle all losses correctly', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'LosingCaller',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 0.5,
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        {
          callerName: 'LosingCaller',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 0.8,
          atlMultiple: 0.8,
          timeToAthMinutes: 0,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      expect(metrics[0]!.winRate).toBe(0.0);
      expect(metrics[0]!.winningCalls).toBe(0);
      expect(metrics[0]!.losingCalls).toBe(2);
    });

    it('GOLDEN: should handle NaN values as losses', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'NaNCaller',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: NaN, // Invalid - should count as loss
          atlMultiple: NaN,
          timeToAthMinutes: 0,
        },
        {
          callerName: 'NaNCaller',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 2.0, // Valid win
          atlMultiple: 1.0,
          timeToAthMinutes: 60,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      expect(metrics[0]!.totalCalls).toBe(2);
      expect(metrics[0]!.winningCalls).toBe(1);
      expect(metrics[0]!.losingCalls).toBe(1); // NaN counts as loss
      expect(metrics[0]!.winRate).toBe(0.5);
    });
  });

  describe('Average Multiple Calculation', () => {
    it('GOLDEN: should calculate average multiple correctly', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'AvgCaller',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 1.0,
          atlMultiple: 0.9,
          timeToAthMinutes: 0,
        },
        {
          callerName: 'AvgCaller',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 2.0,
          atlMultiple: 1.5,
          timeToAthMinutes: 60,
        },
        {
          callerName: 'AvgCaller',
          mint: 'Mint3',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          athMultiple: 3.0,
          atlMultiple: 2.0,
          timeToAthMinutes: 120,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      // Average: (1.0 + 2.0 + 3.0) / 3 = 2.0
      expect(metrics[0]!.avgMultiple).toBeCloseTo(2.0, 10);
      expect(metrics[0]!.bestMultiple).toBe(3.0);
      expect(metrics[0]!.worstMultiple).toBe(1.0);
    });

    it('GOLDEN: should handle empty calls gracefully', () => {
      const calls: CallPerformance[] = [];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      expect(metrics).toHaveLength(0);
    });
  });

  describe('ATH Distribution', () => {
    it('GOLDEN: should bucket ATH multiples correctly', () => {
      const calls: CallPerformance[] = [
        // Loss bucket (<1x)
        {
          callerName: 'Test',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 0.5,
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        // 1.0-1.5x bucket
        {
          callerName: 'Test',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 1.2,
          atlMultiple: 1.0,
          timeToAthMinutes: 60,
        },
        // 2-5x bucket
        {
          callerName: 'Test',
          mint: 'Mint3',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          athMultiple: 3.0,
          atlMultiple: 2.0,
          timeToAthMinutes: 120,
        },
        // 5-10x bucket
        {
          callerName: 'Test',
          mint: 'Mint4',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-04'),
          athMultiple: 7.5,
          atlMultiple: 5.0,
          timeToAthMinutes: 180,
        },
        // 50x+ bucket
        {
          callerName: 'Test',
          mint: 'Mint5',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-05'),
          athMultiple: 100.0,
          atlMultiple: 50.0,
          timeToAthMinutes: 240,
        },
      ];

      const distribution = aggregator.calculateAthDistribution(calls);

      // Verify buckets
      const lossBucket = distribution.find((b) => b.bucket === 'Loss (<1x)');
      expect(lossBucket).toBeDefined();
      expect(lossBucket!.count).toBe(1);
      expect(lossBucket!.percentage).toBeCloseTo(20.0, 1); // 1/5 = 20%

      const bucket1_5 = distribution.find((b) => b.bucket === '1.0-1.5x');
      expect(bucket1_5).toBeDefined();
      expect(bucket1_5!.count).toBe(1);
      expect(bucket1_5!.percentage).toBeCloseTo(20.0, 1);

      const bucket2_5 = distribution.find((b) => b.bucket === '2-5x');
      expect(bucket2_5).toBeDefined();
      expect(bucket2_5!.count).toBe(1);
      expect(bucket2_5!.percentage).toBeCloseTo(20.0, 1);

      const bucket5_10 = distribution.find((b) => b.bucket === '5-10x');
      expect(bucket5_10).toBeDefined();
      expect(bucket5_10!.count).toBe(1);
      expect(bucket5_10!.percentage).toBeCloseTo(20.0, 1);

      const bucket50Plus = distribution.find((b) => b.bucket === '50x+');
      expect(bucket50Plus).toBeDefined();
      expect(bucket50Plus!.count).toBe(1);
      expect(bucket50Plus!.percentage).toBeCloseTo(20.0, 1);

      // Verify percentages sum to 100%
      const totalPercentage = distribution.reduce((sum, b) => sum + b.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100.0, 1);
    });

    it('GOLDEN: should handle boundary values correctly', () => {
      const calls: CallPerformance[] = [
        // Exactly 1.0x (should be in 1.0-1.5x bucket, not loss)
        {
          callerName: 'Boundary',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 1.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 0,
        },
        // Exactly 1.5x (should be in 1.5-2x bucket)
        {
          callerName: 'Boundary',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 1.5,
          atlMultiple: 1.5,
          timeToAthMinutes: 60,
        },
        // Exactly 2.0x (should be in 2-5x bucket)
        {
          callerName: 'Boundary',
          mint: 'Mint3',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          athMultiple: 2.0,
          atlMultiple: 2.0,
          timeToAthMinutes: 120,
        },
      ];

      const distribution = aggregator.calculateAthDistribution(calls);

      const bucket1_5 = distribution.find((b) => b.bucket === '1.0-1.5x');
      expect(bucket1_5!.count).toBe(1); // 1.0x is in this bucket

      const bucket1_5_2 = distribution.find((b) => b.bucket === '1.5-2x');
      expect(bucket1_5_2!.count).toBe(1); // 1.5x is in this bucket

      const bucket2_5 = distribution.find((b) => b.bucket === '2-5x');
      expect(bucket2_5!.count).toBe(1); // 2.0x is in this bucket
    });
  });

  describe('Time to ATH Calculation', () => {
    it('GOLDEN: should calculate average time to ATH correctly', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'TimeCaller',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 2.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 30,
        },
        {
          callerName: 'TimeCaller',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 3.0,
          atlMultiple: 1.5,
          timeToAthMinutes: 60,
        },
        {
          callerName: 'TimeCaller',
          mint: 'Mint3',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          athMultiple: 1.5,
          atlMultiple: 1.0,
          timeToAthMinutes: 90,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      // Average: (30 + 60 + 90) / 3 = 60
      expect(metrics[0]!.avgTimeToAth).toBeCloseTo(60.0, 10);
    });

    it('GOLDEN: should exclude zero timeToAth from average', () => {
      const calls: CallPerformance[] = [
        {
          callerName: 'ZeroTime',
          mint: 'Mint1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          athMultiple: 0.5, // Loss - timeToAth is 0
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        {
          callerName: 'ZeroTime',
          mint: 'Mint2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          athMultiple: 2.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 60,
        },
      ];

      const metrics = aggregator.aggregateCallerMetrics(calls);

      // Only 60 should be included (0 is filtered out)
      expect(metrics[0]!.avgTimeToAth).toBeCloseTo(60.0, 10);
    });
  });
});
