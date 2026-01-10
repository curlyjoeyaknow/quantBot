/**
 * Sequential Stop Loss Detection Tests
 */

import { describe, it, expect } from 'vitest';
import { checkStopLossSequential, type SequentialCheckResult } from '../src/execution/exit';
import type { Candle, CandleProvider } from '../src/types';

describe('Sequential Stop Loss Detection', () => {
  const createCandle = (
    timestamp: number,
    open: number,
    high: number,
    low: number,
    close: number
  ): Candle => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume: 1000,
  });

  describe('checkStopLossSequential', () => {
    it('should detect stop loss when only stop is hit', async () => {
      const candle = createCandle(1000, 100, 105, 90, 95);
      const stopLoss = 95;
      const targetPrice = 110;

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice);
      expect(result.outcome).toBe('stop_loss');
      expect(result.conflictResolved).toBe(true);
    });

    it('should detect target when only target is hit', async () => {
      const candle = createCandle(1000, 100, 110, 95, 105);
      const stopLoss = 90;
      const targetPrice = 110;

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice);
      expect(result.outcome).toBe('target');
      expect(result.conflictResolved).toBe(true);
    });

    it('should return neither when neither is hit', async () => {
      const candle = createCandle(1000, 100, 105, 95, 100);
      const stopLoss = 90;
      const targetPrice = 110;

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice);
      expect(result.outcome).toBe('neither');
    });

    it('should use fallback for same-candle conflicts without provider', async () => {
      const candle = createCandle(1000, 100, 110, 90, 100);
      const stopLoss = 95;
      const targetPrice = 105;

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice);
      expect(result.outcome).toBe('stop_loss'); // Fallback defaults to stop loss
      expect(result.resolutionMethod).toBe('fallback');
    });

    it('should use sub-candles when provider is available', async () => {
      const candle = createCandle(Date.now() / 1000 - 30 * 24 * 60 * 60, 100, 110, 90, 100);
      const stopLoss = 95;
      const targetPrice = 105;

      const mockProvider: CandleProvider = {
        fetchCandles: async () => [
          createCandle(candle.timestamp, 100, 100, 90, 95), // Stop hit first
          createCandle(candle.timestamp + 1, 95, 110, 95, 105), // Then target
        ],
      };

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice, mockProvider);
      expect(result.outcome).toBe('stop_loss');
      expect(result.resolutionMethod).toBe('sub_candle');
      expect(result.subCandlesUsed).toBe(2);
    });

    it('should use fallback for candles older than 3 months', async () => {
      const threeMonthsAgo = Date.now() / 1000 - 100 * 24 * 60 * 60; // > 3 months
      const candle = createCandle(threeMonthsAgo, 100, 110, 90, 100);
      const stopLoss = 95;
      const targetPrice = 105;

      const mockProvider: CandleProvider = {
        fetchCandles: async () => [],
      };

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice, mockProvider);
      expect(result.resolutionMethod).toBe('fallback');
    });

    it('should handle provider errors gracefully', async () => {
      const candle = createCandle(Date.now() / 1000 - 30 * 24 * 60 * 60, 100, 110, 90, 100);
      const stopLoss = 95;
      const targetPrice = 105;

      const errorProvider: CandleProvider = {
        fetchCandles: async () => {
          throw new Error('Provider error');
        },
      };

      const result = await checkStopLossSequential(candle, stopLoss, targetPrice, errorProvider);
      expect(result.resolutionMethod).toBe('fallback');
    });
  });
});
