/**
 * Rolling Window Trailing Stop Tests
 */

import { describe, it, expect } from 'vitest';
import {
  initTrailingStopState,
  updateRollingTrailingStop,
  type TrailingStopState,
} from '../src/execution/exit';
import type { Candle } from '../src/types';
import type { StopLossConfig } from '../src/types/strategy';

describe('Rolling Window Trailing Stop', () => {
  const createCandle = (timestamp: number, low: number, high: number): Candle => ({
    timestamp,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 1000,
  });

  describe('initTrailingStopState', () => {
    it('should initialize with correct defaults', () => {
      const config: StopLossConfig = {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 20,
      };

      const state = initTrailingStopState(100, config);
      expect(state.windowSize).toBe(20);
      expect(state.windowLows).toEqual([]);
      expect(state.currentStop).toBe(50); // 100 * (1 + -0.5)
      expect(state.peakPrice).toBe(100);
    });

    it('should use default window size if not specified', () => {
      const config: StopLossConfig = {
        initial: -0.5,
        trailing: 0.5,
      };

      const state = initTrailingStopState(100, config);
      expect(state.windowSize).toBe(20); // Default
    });
  });

  describe('updateRollingTrailingStop', () => {
    it('should add lows to window', () => {
      const state = initTrailingStopState(100, {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 5,
      });

      const candle1 = createCandle(1000, 90, 110);
      const newState = updateRollingTrailingStop(state, candle1, 0, 0.25);

      expect(newState.windowLows).toHaveLength(1);
      expect(newState.windowLows[0]).toBe(90);
    });

    it('should maintain window size limit', () => {
      const state = initTrailingStopState(100, {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 3,
      });

      let currentState = state;
      for (let i = 0; i < 5; i++) {
        const candle = createCandle(1000 + i, 90 - i, 110);
        currentState = updateRollingTrailingStop(currentState, candle, i, 0.25);
      }

      expect(currentState.windowLows).toHaveLength(3);
    });

    it('should update stop to be X% below window low', () => {
      const state = initTrailingStopState(100, {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 3,
      });

      const candle1 = createCandle(1000, 80, 110);
      const newState = updateRollingTrailingStop(state, candle1, 0, 0.25);

      // Stop should be 25% below window low (80)
      expect(newState.currentStop).toBe(80 * 0.75); // 60
    });

    it('should only move stop up, never down', () => {
      const state = initTrailingStopState(100, {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 3,
      });

      // First candle: low at 80, stop moves to 60
      const candle1 = createCandle(1000, 80, 110);
      let newState = updateRollingTrailingStop(state, candle1, 0, 0.25);
      expect(newState.currentStop).toBe(60);

      // Second candle: low at 90 (higher), but window low is still 80
      const candle2 = createCandle(1001, 90, 110);
      newState = updateRollingTrailingStop(newState, candle2, 1, 0.25);
      expect(newState.currentStop).toBe(60); // Should not decrease

      // Third candle: low at 70 (lower), window low becomes 70, stop moves to 52.5
      const candle3 = createCandle(1002, 70, 110);
      newState = updateRollingTrailingStop(newState, candle3, 2, 0.25);
      expect(newState.currentStop).toBe(70 * 0.75); // 52.5, lower than before
    });

    it('should update peak price', () => {
      const state = initTrailingStopState(100, {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 3,
      });

      const candle1 = createCandle(1000, 90, 120);
      const newState = updateRollingTrailingStop(state, candle1, 0, 0.25);

      expect(newState.peakPrice).toBe(120);
    });

    it('should track window start index correctly', () => {
      const state = initTrailingStopState(100, {
        initial: -0.5,
        trailing: 0.5,
        trailingWindowSize: 3,
      });

      let currentState = state;
      for (let i = 0; i < 5; i++) {
        const candle = createCandle(1000 + i, 90, 110);
        currentState = updateRollingTrailingStop(currentState, candle, i, 0.25);
      }

      // After 5 candles with window size 3, start index should be 2 (5 - 3)
      expect(currentState.windowStartIndex).toBe(2);
    });
  });
});
