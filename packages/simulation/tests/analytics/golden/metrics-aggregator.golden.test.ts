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
import { MetricsAggregator } from '../../../src/analytics/aggregators/MetricsAggregator.js';
import type { CallPerformance } from '../../../src/analytics/types.js';

describe('MetricsAggregator - Golden Tests', () => {
  const aggregator = new MetricsAggregator();

  describe('Win Rate Calculation', () => {
    it('GOLDEN: should calculate win rate correctly for mixed results', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'TestCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0, // Win
          atlPrice: 0.8,
          atlMultiple: 0.8,
          timeToAthMinutes: 60,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'TestCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 0.5,
          athMultiple: 0.5, // Loss
          atlPrice: 0.5,
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        {
          callId: 3,
          tokenAddress: 'Mint3',
          callerName: 'TestCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1.0,
          athPrice: 1.5,
          athMultiple: 1.5, // Win
          atlPrice: 0.9,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'PerfectCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          atlPrice: 1.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 60,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'PerfectCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 3.0,
          athMultiple: 3.0,
          atlPrice: 1.5,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'LosingCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 0.5,
          athMultiple: 0.5,
          atlPrice: 0.5,
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'LosingCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 0.8,
          athMultiple: 0.8,
          atlPrice: 0.8,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'NaNCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: NaN,
          athMultiple: NaN, // Invalid - should count as loss
          atlPrice: NaN,
          atlMultiple: NaN,
          timeToAthMinutes: 0,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'NaNCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0, // Valid win
          atlPrice: 1.0,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'AvgCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 1.0,
          athMultiple: 1.0,
          atlPrice: 0.9,
          atlMultiple: 0.9,
          timeToAthMinutes: 0,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'AvgCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          atlPrice: 1.5,
          atlMultiple: 1.5,
          timeToAthMinutes: 60,
        },
        {
          callId: 3,
          tokenAddress: 'Mint3',
          callerName: 'AvgCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1.0,
          athPrice: 3.0,
          athMultiple: 3.0,
          atlPrice: 2.0,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'Test',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 0.5,
          athMultiple: 0.5,
          atlPrice: 0.5,
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        // 1.0-1.5x bucket
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'Test',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 1.2,
          athMultiple: 1.2,
          atlPrice: 1.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 60,
        },
        // 2-5x bucket
        {
          callId: 3,
          tokenAddress: 'Mint3',
          callerName: 'Test',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1.0,
          athPrice: 3.0,
          athMultiple: 3.0,
          atlPrice: 2.0,
          atlMultiple: 2.0,
          timeToAthMinutes: 120,
        },
        // 5-10x bucket
        {
          callId: 4,
          tokenAddress: 'Mint4',
          callerName: 'Test',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-04'),
          entryPrice: 1.0,
          athPrice: 7.5,
          athMultiple: 7.5,
          atlPrice: 5.0,
          atlMultiple: 5.0,
          timeToAthMinutes: 180,
        },
        // 50x+ bucket
        {
          callId: 5,
          tokenAddress: 'Mint5',
          callerName: 'Test',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-05'),
          entryPrice: 1.0,
          athPrice: 100.0,
          athMultiple: 100.0,
          atlPrice: 50.0,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'Boundary',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 1.0,
          athMultiple: 1.0,
          atlPrice: 1.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 0,
        },
        // Exactly 1.5x (should be in 1.5-2x bucket)
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'Boundary',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 1.5,
          athMultiple: 1.5,
          atlPrice: 1.5,
          atlMultiple: 1.5,
          timeToAthMinutes: 60,
        },
        // Exactly 2.0x (should be in 2-5x bucket)
        {
          callId: 3,
          tokenAddress: 'Mint3',
          callerName: 'Boundary',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          atlPrice: 2.0,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'TimeCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          atlPrice: 1.0,
          atlMultiple: 1.0,
          timeToAthMinutes: 30,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'TimeCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 3.0,
          athMultiple: 3.0,
          atlPrice: 1.5,
          atlMultiple: 1.5,
          timeToAthMinutes: 60,
        },
        {
          callId: 3,
          tokenAddress: 'Mint3',
          callerName: 'TimeCaller',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-03'),
          entryPrice: 1.0,
          athPrice: 1.5,
          athMultiple: 1.5,
          atlPrice: 1.0,
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
          callId: 1,
          tokenAddress: 'Mint1',
          callerName: 'ZeroTime',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1.0,
          athPrice: 0.5,
          athMultiple: 0.5, // Loss - timeToAth is 0
          atlPrice: 0.5,
          atlMultiple: 0.5,
          timeToAthMinutes: 0,
        },
        {
          callId: 2,
          tokenAddress: 'Mint2',
          callerName: 'ZeroTime',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1.0,
          athPrice: 2.0,
          athMultiple: 2.0,
          atlPrice: 1.0,
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
