/**
 * ATH Calculator Tests
 * ====================
 * Unit tests for ATH calculation utility
 */

import { describe, it, expect } from 'vitest';
import {
  calculateAthFromCandles,
  calculateAthFromCandleObjects,
  calculatePeriodAthAtl,
} from '../../src/utils/ath-calculator';
import type { Candle } from '@quantbot/core';

describe('ATH Calculator', () => {
  describe('calculateAthFromCandles', () => {
    it('should calculate ATH and ATL correctly', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 1.5, low: 0.8 }, // Drops to 0.8 (ATL)
        { timestamp: 1200, high: 2.0, low: 1.2 },
        { timestamp: 1300, high: 1.8, low: 1.5 },
        { timestamp: 1400, high: 3.0, low: 2.0 }, // Peaks at 3.0 (ATH)
      ];

      const result = calculateAthFromCandles(entryPrice, entryTimestamp, candles);

      expect(result.athPrice).toBe(3.0);
      expect(result.athMultiple).toBe(3.0);
      expect(result.timeToAthMinutes).toBe((1400 - 1000) / 60);
      expect(result.atlPrice).toBe(0.8);
      expect(result.atlTimestamp).toBe(1100);
      expect(result.atlMultiple).toBe(0.8 / 1.0); // 0.8 = dropped to 80% of entry
    });

    it('should return entry price if no candles after entry', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 2000;
      const candles = [
        { timestamp: 1000, high: 2.0, low: 1.5 },
        { timestamp: 1500, high: 3.0, low: 2.0 },
      ];

      const result = calculateAthFromCandles(entryPrice, entryTimestamp, candles);

      expect(result.athPrice).toBe(entryPrice);
      expect(result.athMultiple).toBe(1.0);
      expect(result.timeToAthMinutes).toBe(0);
      expect(result.atlPrice).toBe(entryPrice);
      expect(result.atlMultiple).toBe(1.0);
    });

    it('should handle empty candles array', () => {
      const result = calculateAthFromCandles(1.0, 1000, []);

      expect(result.athPrice).toBe(1.0);
      expect(result.athMultiple).toBe(1.0);
      expect(result.timeToAthMinutes).toBe(0);
      expect(result.atlPrice).toBe(1.0);
      expect(result.atlMultiple).toBe(1.0);
    });

    it('should cap multiples at 10000x', () => {
      const entryPrice = 0.0001;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 10.0, low: 0.00005 }, // 100000x - should be capped
      ];

      const result = calculateAthFromCandles(entryPrice, entryTimestamp, candles);

      expect(result.athPrice).toBe(entryPrice);
      expect(result.athMultiple).toBe(1.0);
      expect(result.timeToAthMinutes).toBe(0);
      expect(result.atlPrice).toBe(entryPrice);
      expect(result.atlMultiple).toBe(1.0);
    });

    it('should only track ATL until ATH is reached', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 1.2, low: 0.8 }, // ATL at 0.8
        { timestamp: 1200, high: 2.0, low: 1.5 }, // ATH at 2.0
        { timestamp: 1300, high: 1.5, low: 0.5 }, // Lower low, but after ATH - should not update ATL
      ];

      const result = calculateAthFromCandles(entryPrice, entryTimestamp, candles);

      expect(result.athPrice).toBe(2.0);
      expect(result.atlPrice).toBe(0.8); // Should be 0.8, not 0.5 (because 0.5 is after ATH)
      expect(result.atlTimestamp).toBe(1100);
    });
  });

  describe('calculateAthFromCandleObjects', () => {
    it('should calculate ATH from Candle objects', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles: Candle[] = [
        { timestamp: 1100, open: 1.0, high: 1.5, low: 0.9, close: 1.2, volume: 100 },
        { timestamp: 1200, open: 1.2, high: 2.0, low: 1.1, close: 1.8, volume: 200 },
      ];

      const result = calculateAthFromCandleObjects(entryPrice, entryTimestamp, candles);

      expect(result.athPrice).toBe(2.0);
      expect(result.athMultiple).toBe(2.0);
    });
  });

  describe('calculatePeriodAthAtl', () => {
    it('should calculate period ATH/ATL with post-ATH drawdown', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 1.2, low: 0.9 }, // ATL at 0.9
        { timestamp: 1200, high: 2.0, low: 1.5 }, // ATH at 2.0
        { timestamp: 1300, high: 1.8, low: 1.2 },
        { timestamp: 1400, high: 1.5, low: 1.0 }, // Drawdown to 1.0 (50% from ATH)
        { timestamp: 1500, high: 1.8, low: 1.3 }, // Recovery
      ];

      const result = calculatePeriodAthAtl(entryPrice, entryTimestamp, candles);

      expect(result.periodAthPrice).toBe(2.0);
      expect(result.periodAthTimestamp).toBe(1200);
      expect(result.periodAthMultiple).toBe(2.0);
      expect(result.periodAtlPrice).toBe(0.9);
      expect(result.periodAtlTimestamp).toBe(1100);
      expect(result.postAthDrawdownPrice).toBe(1.0);
      expect(result.postAthDrawdownTimestamp).toBe(1400);
      expect(result.postAthDrawdownPercent).toBeCloseTo(50.0, 1); // 50% drop from ATH
    });

    it('should identify re-entry opportunities', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 2.0, low: 1.5 }, // ATH at 2.0
        { timestamp: 1200, high: 1.8, low: 1.2 }, // Drawdown to 1.2 (40% from ATH)
        { timestamp: 1300, high: 1.9, low: 1.3 }, // Recovery to 1.9 (58% recovery from 1.2)
        { timestamp: 1400, high: 1.5, low: 1.0 }, // Another drawdown to 1.0 (50% from ATH)
        { timestamp: 1500, high: 1.6, low: 1.1 }, // Recovery to 1.6 (60% recovery from 1.0)
      ];

      const result = calculatePeriodAthAtl(
        entryPrice,
        entryTimestamp,
        candles,
        undefined,
        20, // minDrawdownPercent
        10 // minRecoveryPercent
      );

      expect(result.reEntryOpportunities).toBeDefined();
      expect(result.reEntryOpportunities!.length).toBeGreaterThan(0);

      // Check first re-entry opportunity
      const firstOpp = result.reEntryOpportunities![0];
      expect(firstOpp.drawdownFromAth).toBeGreaterThanOrEqual(20);
      expect(firstOpp.recoveryMultiple).toBeDefined();
      expect(firstOpp.recoveryMultiple!).toBeGreaterThan(1.0);
    });

    it('should handle period end timestamp', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 2.0, low: 1.5 },
        { timestamp: 1200, high: 3.0, low: 2.0 }, // ATH at 3.0
        { timestamp: 1300, high: 2.5, low: 1.8 },
        { timestamp: 1400, high: 2.0, low: 1.5 },
      ];

      // Limit period to timestamp 1200
      const result = calculatePeriodAthAtl(entryPrice, entryTimestamp, candles, 1200);

      expect(result.periodAthPrice).toBe(2.0); // Should be 2.0, not 3.0 (period ends at 1200)
      expect(result.periodAthTimestamp).toBe(1100);
    });

    it('should return empty result for invalid inputs', () => {
      const result1 = calculatePeriodAthAtl(0, 1000, []);
      expect(result1.periodAthPrice).toBe(0);
      expect(result1.periodAthMultiple).toBe(1);

      const result2 = calculatePeriodAthAtl(1.0, 0, []);
      expect(result2.periodAthPrice).toBe(1.0);
      expect(result2.periodAthMultiple).toBe(1);

      const result3 = calculatePeriodAthAtl(1.0, 1000, []);
      expect(result3.periodAthPrice).toBe(1.0);
      expect(result3.periodAthMultiple).toBe(1);
    });

    it('should not identify re-entries below minimum drawdown threshold', () => {
      const entryPrice = 1.0;
      const entryTimestamp = 1000;
      const candles = [
        { timestamp: 1100, high: 2.0, low: 1.5 }, // ATH at 2.0
        { timestamp: 1200, high: 1.9, low: 1.7 }, // Small drawdown (15% from ATH)
        { timestamp: 1300, high: 2.0, low: 1.8 }, // Recovery
      ];

      const result = calculatePeriodAthAtl(
        entryPrice,
        entryTimestamp,
        candles,
        undefined,
        20 // minDrawdownPercent = 20% (15% drawdown should be ignored)
      );

      expect(result.reEntryOpportunities).toBeUndefined();
    });
  });
});
