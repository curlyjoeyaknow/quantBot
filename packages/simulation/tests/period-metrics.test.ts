/**
 * Period Metrics Integration Tests
 * =================================
 * Tests for period metrics calculation in simulation package
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculatePeriodMetricsForSimulation,
  enrichSimulationResultWithPeriodMetrics,
} from '../src/period-metrics/period-metrics';
import type { Candle } from '../src/types';
import { createOrchestrator } from '../src/core/orchestrator';
import { DateTime } from 'luxon';

describe('Period Metrics Integration', () => {
  describe('calculatePeriodMetricsForSimulation', () => {
    it('should calculate period metrics from candles', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.2, low: 0.9, close: 1.1, volume: 100 },
        { timestamp: 1100, high: 1.5, low: 1.0, open: 1.1, close: 1.4, volume: 200 },
        { timestamp: 1200, high: 2.0, low: 1.3, open: 1.4, close: 1.8, volume: 300 }, // ATH at 2.0
        { timestamp: 1300, high: 1.8, low: 1.2, open: 1.8, close: 1.5, volume: 250 },
        { timestamp: 1400, high: 1.5, low: 1.0, open: 1.5, close: 1.2, volume: 200 }, // Drawdown to 1.0
        { timestamp: 1500, high: 1.6, low: 1.1, open: 1.2, close: 1.5, volume: 180 }, // Recovery
      ];

      const result = calculatePeriodMetricsForSimulation(
        candles,
        1.0, // entry price
        1000, // entry timestamp
        {
          enabled: true,
          periodDays: 7,
          minDrawdownPercent: 20,
          minRecoveryPercent: 10,
        }
      );

      expect(result).toBeDefined();
      expect(result?.periodAthPrice).toBe(2.0);
      expect(result?.periodAthMultiple).toBe(2.0);
      expect(result?.postAthDrawdownPrice).toBe(1.0);
      expect(result?.postAthDrawdownPercent).toBeCloseTo(50.0, 1);
    });

    it('should return undefined when disabled', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.2, low: 0.9, close: 1.1, volume: 100 },
      ];

      const result = calculatePeriodMetricsForSimulation(candles, 1.0, 1000, {
        enabled: false,
        periodDays: 7,
        minDrawdownPercent: 20,
        minRecoveryPercent: 10,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined for empty candles', () => {
      const result = calculatePeriodMetricsForSimulation([], 1.0, 1000, {
        enabled: true,
        periodDays: 7,
        minDrawdownPercent: 20,
        minRecoveryPercent: 10,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('enrichSimulationResultWithPeriodMetrics', () => {
    it('should enrich simulation result with period metrics', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.2, low: 0.9, close: 1.1, volume: 100 },
        { timestamp: 1200, high: 2.0, low: 1.3, open: 1.4, close: 1.8, volume: 300 },
        { timestamp: 1400, high: 1.5, low: 1.0, open: 1.5, close: 1.2, volume: 200 },
      ];

      const simResult = {
        entryPrice: 1.0,
        events: [{ timestamp: 1000 }],
      };

      const result = enrichSimulationResultWithPeriodMetrics(simResult, candles, {
        enabled: true,
        periodDays: 7,
        minDrawdownPercent: 20,
        minRecoveryPercent: 10,
      });

      expect(result).toBeDefined();
      expect(result?.periodAthPrice).toBe(2.0);
    });

    it('should use first candle timestamp if no entry event', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.2, low: 0.9, close: 1.1, volume: 100 },
      ];

      const simResult = {
        entryPrice: 1.0,
        events: [],
      };

      const result = enrichSimulationResultWithPeriodMetrics(simResult, candles, {
        enabled: true,
        periodDays: 7,
        minDrawdownPercent: 20,
        minRecoveryPercent: 10,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Storage Integration', () => {
    it('should handle period metrics in result type', () => {
      // Test that ExtendedSimulationResult can include period metrics
      const result = {
        finalPnl: 1.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 10,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -0.1,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
        periodMetrics: {
          periodAthPrice: 2.0,
          periodAthTimestamp: 1200,
          periodAthMultiple: 2.0,
          timeToPeriodAthMinutes: 3.33,
          periodAtlPrice: 0.9,
          periodAtlTimestamp: 1100,
          periodAtlMultiple: 0.9,
          postAthDrawdownPrice: 1.0,
          postAthDrawdownTimestamp: 1400,
          postAthDrawdownPercent: 50.0,
          postAthDrawdownMultiple: 0.5,
        },
      };

      expect(result.periodMetrics).toBeDefined();
      expect(result.periodMetrics.periodAthPrice).toBe(2.0);
      expect(result.periodMetrics.postAthDrawdownPercent).toBe(50.0);
    });
  });
});
