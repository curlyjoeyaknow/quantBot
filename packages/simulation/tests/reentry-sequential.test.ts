/**
 * Sequential Re-entry Validation Tests
 */

import { describe, it, expect } from 'vitest';
import { validateReEntrySequence } from '../src/execution/reentry';
import type { Candle } from '../src/types';

describe('Sequential Re-entry Validation', () => {
  const createCandle = (timestamp: number, low: number, high: number): Candle => ({
    timestamp,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 1000,
  });

  describe('validateReEntrySequence', () => {
    it('should allow re-entry when no stop loss hit', () => {
      const candles = [
        createCandle(1000, 100, 110), // Exit at index 0
        createCandle(1001, 95, 105),
        createCandle(1002, 90, 100),
        createCandle(1003, 85, 95), // Re-entry attempt at index 3
      ];
      const stopLossPrice = 80;

      const isValid = validateReEntrySequence(candles, 0, 3, stopLossPrice);
      expect(isValid).toBe(true);
    });

    it('should reject re-entry when stop loss hit between exit and re-entry', () => {
      const candles = [
        createCandle(1000, 100, 110), // Exit at index 0
        createCandle(1001, 95, 105),
        createCandle(1002, 75, 85), // Stop loss hit at index 2 (low 75 <= 80)
        createCandle(1003, 85, 95), // Re-entry attempt at index 3
      ];
      const stopLossPrice = 80;

      const isValid = validateReEntrySequence(candles, 0, 3, stopLossPrice);
      expect(isValid).toBe(false);
    });

    it('should reject re-entry when stop loss hit exactly at exit', () => {
      const candles = [
        createCandle(1000, 75, 110), // Exit at index 0, stop also hit (low 75 <= 80)
        createCandle(1001, 85, 95), // Re-entry attempt at index 1
      ];
      const stopLossPrice = 80;

      const isValid = validateReEntrySequence(candles, 0, 1, stopLossPrice);
      expect(isValid).toBe(false);
    });

    it('should allow re-entry when stop loss price is never reached', () => {
      const candles = [
        createCandle(1000, 100, 110), // Exit at index 0
        createCandle(1001, 95, 105),
        createCandle(1002, 90, 100),
        createCandle(1003, 85, 95),
        createCandle(1004, 82, 92), // Re-entry attempt at index 4
      ];
      const stopLossPrice = 80; // Never hit

      const isValid = validateReEntrySequence(candles, 0, 4, stopLossPrice);
      expect(isValid).toBe(true);
    });

    it('should handle edge case with same exit and re-entry index', () => {
      const candles = [
        createCandle(1000, 100, 110), // Exit and re-entry at same index
      ];
      const stopLossPrice = 80;

      const isValid = validateReEntrySequence(candles, 0, 0, stopLossPrice);
      // Should be valid since no candles between exit and re-entry
      expect(isValid).toBe(true);
    });

    it('should check all candles in range', () => {
      const candles = [
        createCandle(1000, 100, 110), // Exit at index 0
        createCandle(1001, 95, 105), // OK
        createCandle(1002, 90, 100), // OK
        createCandle(1003, 75, 85), // Stop hit
        createCandle(1004, 85, 95), // OK but doesn't matter
        createCandle(1005, 82, 92), // Re-entry attempt at index 5
      ];
      const stopLossPrice = 80;

      const isValid = validateReEntrySequence(candles, 0, 5, stopLossPrice);
      expect(isValid).toBe(false);
    });
  });
});
