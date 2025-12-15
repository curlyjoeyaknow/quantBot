/**
 * Period Metrics Tests
 * ====================
 * Unit tests for period-metrics utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enrichCallWithPeriodMetrics,
  enrichCallsWithPeriodMetrics,
  analyzeReEntryOpportunities,
} from '../src/utils/period-metrics';
import type { CallPerformance } from '../src/types';

// Mock dependencies
const mockStorageEngine = {
  getCandles: vi.fn(),
};

vi.mock('@quantbot/storage', () => ({
  getStorageEngine: vi.fn(() => mockStorageEngine),
}));

vi.mock('../src/utils/ath-calculator', () => ({
  calculatePeriodAthAtlFromCandles: vi.fn(
    (entryPrice, entryTimestamp, candles, periodEnd, minDrawdown, minRecovery) => ({
      periodAthPrice: 2,
      periodAthTimestamp: entryTimestamp + 3600,
      periodAthMultiple: 2,
      timeToPeriodAthMinutes: 60,
      periodAtlPrice: 0.5,
      periodAtlTimestamp: entryTimestamp + 1800,
      periodAtlMultiple: 2,
      postAthDrawdownPrice: 1,
      postAthDrawdownTimestamp: entryTimestamp + 7200,
      postAthDrawdownPercent: 50,
      postAthDrawdownMultiple: 0.5,
      reEntryOpportunities: [
        {
          timestamp: entryTimestamp + 7200,
          price: 1,
          drawdownFromAth: 50,
          recoveryMultiple: 1.5,
          recoveryTimestamp: entryTimestamp + 10800,
        },
      ],
    })
  ),
}));

describe('period-metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('enrichCallWithPeriodMetrics', () => {
    it('should enrich a call with period metrics', async () => {
      const call: CallPerformance = {
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
      };

      mockStorageEngine.getCandles.mockResolvedValueOnce([
        {
          timestamp: 1704067200,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 1000,
        },
      ]);

      const result = await enrichCallWithPeriodMetrics(call);

      expect(result.periodMetrics).toBeDefined();
      expect(result.periodMetrics?.periodAthPrice).toBe(2);
      expect(result.periodMetrics?.periodAthMultiple).toBe(2);
      expect(result.periodMetrics?.reEntryOpportunities).toHaveLength(1);
    });

    it('should use default period of 7 days', async () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: 'token1',
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      };

      mockStorageEngine.getCandles.mockResolvedValueOnce([]);

      await enrichCallWithPeriodMetrics(call);

      const callArgs = mockStorageEngine.getCandles.mock.calls[0];
      const alertTime = callArgs[2];
      const periodEnd = callArgs[3];
      const diff = periodEnd.diff(alertTime, 'days').days;
      expect(diff).toBe(7);
    });

    it('should use custom period days', async () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: 'token1',
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      };

      mockStorageEngine.getCandles.mockResolvedValueOnce([]);

      await enrichCallWithPeriodMetrics(call, { periodDays: 14 });

      const callArgs = mockStorageEngine.getCandles.mock.calls[0];
      const alertTime = callArgs[2];
      const periodEnd = callArgs[3];
      const diff = periodEnd.diff(alertTime, 'days').days;
      expect(diff).toBe(14);
    });

    it('should try 5m candles first, then 1m', async () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: 'token1',
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      };

      mockStorageEngine.getCandles
        .mockResolvedValueOnce([]) // 5m empty
        .mockResolvedValueOnce([
          {
            timestamp: 1704067200,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 1000,
          },
        ]); // 1m has data

      await enrichCallWithPeriodMetrics(call);

      expect(mockStorageEngine.getCandles).toHaveBeenCalledTimes(2);
      expect(mockStorageEngine.getCandles.mock.calls[0][4]).toMatchObject({ interval: '5m' });
      expect(mockStorageEngine.getCandles.mock.calls[1][4]).toMatchObject({ interval: '1m' });
    });

    it('should return original call if no candles found', async () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: 'token1',
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      };

      mockStorageEngine.getCandles.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await enrichCallWithPeriodMetrics(call);

      expect(result).toEqual(call);
      expect(result.periodMetrics).toBeUndefined();
    });

    it('should handle errors gracefully', async () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: 'token1',
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      };

      mockStorageEngine.getCandles.mockRejectedValueOnce(new Error('Database error'));

      const result = await enrichCallWithPeriodMetrics(call);

      expect(result).toEqual(call);
      expect(result.periodMetrics).toBeUndefined();
    });
  });

  describe('enrichCallsWithPeriodMetrics', () => {
    it('should enrich multiple calls', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
      ];

      mockStorageEngine.getCandles.mockResolvedValue([
        {
          timestamp: 1704067200,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 1000,
        },
      ]);

      const result = await enrichCallsWithPeriodMetrics(calls);

      expect(result).toHaveLength(2);
      expect(result[0].periodMetrics).toBeDefined();
      expect(result[1].periodMetrics).toBeDefined();
    });

    it('should process calls in batches', async () => {
      const calls: CallPerformance[] = Array.from({ length: 25 }, (_, i) => ({
        callId: i + 1,
        tokenAddress: `token${i}`,
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      }));

      mockStorageEngine.getCandles.mockResolvedValue([]);

      await enrichCallsWithPeriodMetrics(calls);

      // Should process in batches of 10
      expect(mockStorageEngine.getCandles.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle empty calls array', async () => {
      const result = await enrichCallsWithPeriodMetrics([]);
      expect(result).toEqual([]);
    });
  });

  describe('analyzeReEntryOpportunities', () => {
    it('should analyze re-entry opportunities from enriched calls', () => {
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
          periodMetrics: {
            periodAthPrice: 2,
            periodAthTimestamp: new Date('2024-01-01T01:00:00'),
            periodAthMultiple: 2,
            timeToPeriodAthMinutes: 60,
            periodAtlPrice: 0.5,
            periodAtlMultiple: 2,
            reEntryOpportunities: [
              {
                timestamp: new Date('2024-01-01T02:00:00'),
                price: 1,
                drawdownFromAth: 50,
                recoveryMultiple: 1.5,
                recoveryTimestamp: new Date('2024-01-01T03:00:00'),
              },
              {
                timestamp: new Date('2024-01-01T04:00:00'),
                price: 0.8,
                drawdownFromAth: 60,
                recoveryMultiple: undefined,
                recoveryTimestamp: undefined,
              },
            ],
          },
        },
        {
          callId: 2,
          tokenAddress: 'token2',
          callerName: 'caller2',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-02'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
          // No periodMetrics
        },
      ];

      const result = analyzeReEntryOpportunities(calls);

      expect(result).toMatchObject({
        totalCalls: 2,
        callsWithReEntries: 1,
        totalReEntryOpportunities: 2,
        successfulReEntries: 1,
        failedReEntries: 1,
      });
      expect(result.avgDrawdownPercent).toBe(55); // (50 + 60) / 2
      expect(result.avgRecoveryMultiple).toBe(1.5);
    });

    it('should handle calls without re-entry opportunities', () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
      ];

      const result = analyzeReEntryOpportunities(calls);

      expect(result).toMatchObject({
        totalCalls: 1,
        callsWithReEntries: 0,
        totalReEntryOpportunities: 0,
        avgDrawdownPercent: 0,
        avgRecoveryMultiple: 0,
        successfulReEntries: 0,
        failedReEntries: 0,
      });
    });

    it('should handle empty calls array', () => {
      const result = analyzeReEntryOpportunities([]);

      expect(result).toMatchObject({
        totalCalls: 0,
        callsWithReEntries: 0,
        totalReEntryOpportunities: 0,
        avgDrawdownPercent: 0,
        avgRecoveryMultiple: 0,
        successfulReEntries: 0,
        failedReEntries: 0,
      });
    });
  });
});
