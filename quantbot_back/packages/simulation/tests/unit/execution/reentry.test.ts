import { describe, it, expect } from 'vitest';
import {
  initReEntryState,
  startReEntryWait,
  checkReEntry,
  validateReEntrySequence,
  completeReEntry,
  cancelReEntryWait,
  canReEnter,
  DEFAULT_REENTRY,
} from '../../../src/execution/reentry';
import type { Candle } from '../../../src/types/candle';
import type { ReEntryConfig } from '../../../src/types';

describe('Re-Entry Logic', () => {
  const mockCandles: Candle[] = [
    { timestamp: 1000, open: 2.0, high: 2.1, low: 1.9, close: 2.05, volume: 1000 },
    { timestamp: 2000, open: 2.05, high: 2.2, low: 1.8, close: 2.1, volume: 1200 },
    { timestamp: 3000, open: 2.1, high: 2.3, low: 1.7, close: 2.2, volume: 1500 },
  ];

  describe('initReEntryState', () => {
    it('should initialize re-entry state', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 3, sizePercent: 0.5 };
      const state = initReEntryState(config);
      expect(state.waiting).toBe(false);
      expect(state.count).toBe(0);
      expect(state.maxCount).toBe(3);
    });
  });

  describe('startReEntryWait', () => {
    it('should start waiting for re-entry', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 3, sizePercent: 0.5 };
      const state = initReEntryState(config);
      const updated = startReEntryWait(state, 2.0, config);
      expect(updated.waiting).toBe(true);
      expect(updated.triggerPrice).toBe(2.0 * 0.9); // 10% retrace
      expect(updated.referencePrice).toBe(2.0);
    });

    it('should not start if max re-entries reached', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 1, sizePercent: 0.5 };
      const state = initReEntryState(config);
      state.count = 1;
      const updated = startReEntryWait(state, 2.0, config);
      expect(updated.waiting).toBe(false);
    });
  });

  describe('checkReEntry', () => {
    it('should trigger re-entry when price drops to trigger', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 3, sizePercent: 0.5 };
      const state = initReEntryState(config);
      const waitingState = startReEntryWait(state, 2.0, config);
      const candle: Candle = {
        timestamp: 2000,
        open: 1.8,
        high: 1.85,
        low: 1.75, // Below trigger (1.8)
        close: 1.8,
        volume: 1000,
      };
      const result = checkReEntry(candle, waitingState, config);
      expect(result).not.toBeNull();
      expect(result?.shouldReEnter).toBe(true);
      expect(result?.price).toBe(waitingState.triggerPrice);
    });

    it('should return null if not waiting', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 3, sizePercent: 0.5 };
      const state = initReEntryState(config);
      const candle: Candle = {
        timestamp: 2000,
        open: 1.8,
        high: 1.85,
        low: 1.75,
        close: 1.8,
        volume: 1000,
      };
      const result = checkReEntry(candle, state, config);
      expect(result).toBeNull();
    });
  });

  describe('validateReEntrySequence', () => {
    it('should validate re-entry sequence', () => {
      const isValid = validateReEntrySequence(mockCandles, 0, 2, 1.5);
      expect(isValid).toBe(true);
    });

    it('should reject if stop loss hit between exit and re-entry', () => {
      const candles: Candle[] = [
        { timestamp: 1000, open: 2.0, high: 2.1, low: 1.5, close: 2.05, volume: 1000 },
        { timestamp: 2000, open: 1.9, high: 2.0, low: 1.4, close: 1.95, volume: 1200 },
      ];
      const isValid = validateReEntrySequence(candles, 0, 1, 1.6);
      expect(isValid).toBe(false); // Stop loss at 1.6 was hit
    });
  });

  describe('completeReEntry', () => {
    it('should complete re-entry and increment count', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 3, sizePercent: 0.5 };
      const state = initReEntryState(config);
      const waitingState = startReEntryWait(state, 2.0, config);
      const completed = completeReEntry(waitingState);
      expect(completed.waiting).toBe(false);
      expect(completed.count).toBe(1);
    });
  });

  describe('canReEnter', () => {
    it('should allow re-entry if under max count', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 3, sizePercent: 0.5 };
      const state = initReEntryState(config);
      expect(canReEnter(state)).toBe(true);
    });

    it('should not allow re-entry if max count reached', () => {
      const config: ReEntryConfig = { trailingReEntry: 0.1, maxReEntries: 1, sizePercent: 0.5 };
      const state = initReEntryState(config);
      state.count = 1;
      expect(canReEnter(state)).toBe(false);
    });
  });
});
