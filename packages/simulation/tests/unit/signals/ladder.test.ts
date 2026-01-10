import { describe, it, expect } from 'vitest';
import {
  evaluateLadderLegs,
  calculateLadderEntryPrice,
  calculateLadderExitPrice,
  getTotalLadderSize,
  normalizeLadderLegs,
} from '../../../src/signals/ladder';
import { getLadderLegId } from '../../../src/types';
import type { LadderConfig, LadderLeg } from '../../../src/types';
import type { Candle } from '../../../src/types/candle';
import type { LegacyIndicatorData } from '../../../src/indicators/registry';

describe('Ladder Evaluation', () => {
  const mockCandle: Candle = {
    timestamp: 1000,
    open: 1.0,
    high: 1.2,
    low: 0.8,
    close: 1.1,
    volume: 1000,
  };

  const mockIndicators: LegacyIndicatorData = {
    candle: mockCandle,
    index: 0,
    movingAverages: {
      sma9: 1.05,
      sma20: 1.0,
      sma50: 0.95,
      ema9: 1.06,
      ema20: 1.01,
      ema50: 0.96,
    },
    ichimoku: null,
    macd: null,
  };

  describe('evaluateLadderLegs', () => {
    it('should evaluate ladder legs without signals', () => {
      const ladder: LadderConfig = {
        legs: [
          { sizePercent: 0.5, multiple: 2.0 },
          { sizePercent: 0.5, multiple: 3.0 },
        ],
        sequential: false,
      };
      const result = evaluateLadderLegs(
        ladder,
        {
          candle: mockCandle,
          indicators: mockIndicators,
        },
        new Set()
      );
      expect(result.executableLegs.length).toBe(2);
    });

    it('should skip already executed legs', () => {
      const ladder: LadderConfig = {
        legs: [
          { sizePercent: 0.5, multiple: 2.0 },
          { sizePercent: 0.5, multiple: 3.0 },
        ],
        sequential: false,
      };
      // Get the actual leg ID format from getLadderLegId
      // Format is: `${leg.sizePercent}:${leg.priceOffset ?? 0}:${leg.multiple ?? 0}`
      const legId = getLadderLegId(ladder.legs[0]); // Should be "0.5:0:2"
      const executedIds = new Set([legId]);
      const result = evaluateLadderLegs(
        ladder,
        {
          candle: mockCandle,
          indicators: mockIndicators,
        },
        executedIds
      );
      // First leg is executed, so only second leg should be executable
      expect(result.executableLegs.length).toBe(1);
      expect(result.executableLegs[0].multiple).toBe(3.0);
    });
  });

  describe('calculateLadderEntryPrice', () => {
    it('should calculate entry price with offset', () => {
      const leg: LadderLeg = { sizePercent: 0.5, priceOffset: -0.1 };
      const price = calculateLadderEntryPrice(leg, 1.0);
      expect(price).toBe(0.9); // 1.0 * (1 - 0.1)
    });

    it('should return base price if no offset', () => {
      const leg: LadderLeg = { sizePercent: 0.5 };
      const price = calculateLadderEntryPrice(leg, 1.0);
      expect(price).toBe(1.0);
    });
  });

  describe('calculateLadderExitPrice', () => {
    it('should calculate exit price with multiple', () => {
      const leg: LadderLeg = { sizePercent: 0.5, multiple: 2.0 };
      const price = calculateLadderExitPrice(leg, 1.0);
      expect(price).toBe(2.0);
    });

    it('should calculate exit price with offset', () => {
      const leg: LadderLeg = { sizePercent: 0.5, priceOffset: 0.1 };
      const price = calculateLadderExitPrice(leg, 1.0);
      expect(price).toBe(1.1); // 1.0 * (1 + 0.1)
    });
  });

  describe('getTotalLadderSize', () => {
    it('should sum ladder leg sizes', () => {
      const legs: LadderLeg[] = [
        { sizePercent: 0.3, multiple: 2.0 },
        { sizePercent: 0.4, multiple: 3.0 },
        { sizePercent: 0.3, multiple: 5.0 },
      ];
      const total = getTotalLadderSize(legs);
      expect(total).toBe(1.0);
    });
  });

  describe('normalizeLadderLegs', () => {
    it('should normalize legs to sum to 1', () => {
      const legs: LadderLeg[] = [
        { sizePercent: 0.5, multiple: 2.0 },
        { sizePercent: 0.5, multiple: 3.0 },
      ];
      const normalized = normalizeLadderLegs(legs);
      expect(getTotalLadderSize(normalized)).toBe(1.0);
    });

    it('should not normalize if already sums to 1', () => {
      const legs: LadderLeg[] = [
        { sizePercent: 0.5, multiple: 2.0 },
        { sizePercent: 0.5, multiple: 3.0 },
      ];
      const normalized = normalizeLadderLegs(legs);
      expect(normalized).toEqual(legs);
    });
  });
});
