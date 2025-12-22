import { describe, it, expect } from 'vitest';
import {
  calculateStopLoss,
  updateTrailingStop,
  checkProfitTarget,
  checkStopLoss,
  calculateTrailingEntry,
} from '../../../src/engine/TradeLifecycle';
import type { Candle } from '../../../src/types/candle';
import type { StopLossConfig, EntryConfig } from '../../../src/types';

describe('Trade Lifecycle', () => {
  const mockCandles: Candle[] = [
    { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
    { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
    { timestamp: 3000, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 },
  ];

  describe('calculateStopLoss', () => {
    it('should calculate stop loss price', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 0.5 };
      const stopLoss = calculateStopLoss(1.0, config);
      expect(stopLoss).toBe(0.7); // 1.0 * (1 - 0.3)
    });
  });

  describe('updateTrailingStop', () => {
    it('should update trailing stop when price increases', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 0.2 };
      const position = {
        size: 1.0,
        entryPrice: 1.0,
        entryTimestamp: 1000,
        stopLoss: 0.7,
        trailingStop: undefined,
        profitTargets: [],
      };
      const newStop = updateTrailingStop(1.5, position, config);
      expect(newStop).toBeDefined();
      expect(newStop).toBeGreaterThan(0.7);
    });

    it('should return undefined if trailing is none', () => {
      const config: StopLossConfig = { initial: -0.3, trailing: 'none' };
      const position = {
        size: 1.0,
        entryPrice: 1.0,
        entryTimestamp: 1000,
        stopLoss: 0.7,
        trailingStop: undefined,
        profitTargets: [],
      };
      const newStop = updateTrailingStop(1.5, position, config);
      expect(newStop).toBeUndefined();
    });
  });

  describe('checkProfitTarget', () => {
    it('should return true when target is hit', () => {
      const hit = checkProfitTarget(2.0, 1.0, 2.0);
      expect(hit).toBe(true);
    });

    it('should return false when target not hit', () => {
      const hit = checkProfitTarget(1.5, 1.0, 2.0);
      expect(hit).toBe(false);
    });
  });

  describe('checkStopLoss', () => {
    it('should return true when stop loss is hit', () => {
      const hit = checkStopLoss(0.7, 0.7);
      expect(hit).toBe(true);
    });

    it('should return false when stop loss not hit', () => {
      const hit = checkStopLoss(0.8, 0.7);
      expect(hit).toBe(false);
    });
  });

  describe('calculateTrailingEntry', () => {
    it('should calculate trailing entry', () => {
      const config: EntryConfig = {
        initialEntry: 'none',
        trailingEntry: 0.1,
        maxWaitTime: 60,
      };
      const result = calculateTrailingEntry(mockCandles, 0, config);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.price).toBeGreaterThan(0);
        expect(result.index).toBeGreaterThanOrEqual(0);
      }
    });

    it('should return null if trailing entry is none', () => {
      const config: EntryConfig = {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60,
      };
      const result = calculateTrailingEntry(mockCandles, 0, config);
      expect(result).toBeNull();
    });
  });
});
