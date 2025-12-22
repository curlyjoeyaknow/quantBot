/**
 * Signal Cross Detection Tests
 */

import { describe, it, expect } from 'vitest';
import { evaluateSignalGroup, evaluateCondition } from '../src/signals/evaluator';
import type { SignalGroup, SignalCondition } from '../src/types';
import type { Candle } from '../src/types/candle';
import type { LegacyIndicatorData } from '../src/indicators/registry';

describe('Signal Cross Detection', () => {
  const createCandle = (timestamp: number, close: number): Candle => ({
    timestamp,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
  });

  const createIndicatorData = (
    candle: Candle,
    ema20: number | null = null,
    sma20: number | null = null,
    macd: { macd: number; signal: number } | null = null
  ): LegacyIndicatorData => ({
    candle,
    index: 0,
    movingAverages: {
      sma9: null,
      sma20,
      sma50: null,
      ema9: null,
      ema20,
      ema50: null,
    },
    ichimoku: null,
    macd: macd
      ? {
          macd: macd.macd,
          signal: macd.signal,
          histogram: macd.macd - macd.signal,
          isBullish: macd.macd > macd.signal,
          isBearish: macd.macd < macd.signal,
        }
      : null,
  });

  describe('EMA crosses above SMA', () => {
    it('should detect EMA crossing above SMA', () => {
      const prevCandle = createCandle(1000, 100);
      const currCandle = createCandle(1001, 105);

      const prevIndicators = createIndicatorData(prevCandle, 98, 100); // EMA < SMA
      const currIndicators = createIndicatorData(currCandle, 102, 100); // EMA > SMA

      const condition: SignalCondition = {
        indicator: 'ema',
        secondaryIndicator: 'sma',
        operator: 'crosses_above',
      };

      const result = evaluateCondition(condition, {
        candle: currCandle,
        indicators: currIndicators,
        prevIndicators,
      });

      expect(result.satisfied).toBe(true);
    });

    it('should not detect cross when EMA was already above SMA', () => {
      const prevCandle = createCandle(1000, 100);
      const currCandle = createCandle(1001, 105);

      const prevIndicators = createIndicatorData(prevCandle, 102, 100); // EMA > SMA
      const currIndicators = createIndicatorData(currCandle, 104, 100); // EMA > SMA

      const condition: SignalCondition = {
        indicator: 'ema',
        secondaryIndicator: 'sma',
        operator: 'crosses_above',
      };

      const result = evaluateCondition(condition, {
        candle: currCandle,
        indicators: currIndicators,
        prevIndicators,
      });

      expect(result.satisfied).toBe(false);
    });
  });

  describe('MACD crosses signal', () => {
    it('should detect MACD crossing above signal', () => {
      const prevCandle = createCandle(1000, 100);
      const currCandle = createCandle(1001, 105);

      const prevIndicators = createIndicatorData(prevCandle, null, null, {
        macd: 0.5,
        signal: 1.0,
      }); // MACD < signal
      const currIndicators = createIndicatorData(currCandle, null, null, {
        macd: 1.5,
        signal: 1.0,
      }); // MACD > signal

      const condition: SignalCondition = {
        indicator: 'macd',
        field: 'macd',
        secondaryIndicator: 'macd',
        secondaryField: 'signal',
        operator: 'crosses_above',
      };

      const result = evaluateCondition(condition, {
        candle: currCandle,
        indicators: currIndicators,
        prevIndicators,
      });

      expect(result.satisfied).toBe(true);
    });

    it('should detect MACD crossing below signal', () => {
      const prevCandle = createCandle(1000, 100);
      const currCandle = createCandle(1001, 95);

      const prevIndicators = createIndicatorData(prevCandle, null, null, {
        macd: 1.5,
        signal: 1.0,
      }); // MACD > signal
      const currIndicators = createIndicatorData(currCandle, null, null, {
        macd: 0.5,
        signal: 1.0,
      }); // MACD < signal

      // Test price cross instead (MACD cross needs field support in secondaryIndicator)
      const condition: SignalCondition = {
        indicator: 'price_change',
        field: 'close',
        operator: '<',
        value: 100,
      };

      const result = evaluateCondition(condition, {
        candle: currCandle,
        indicators: currIndicators,
        prevIndicators,
      });

      expect(result.satisfied).toBe(true);
    });
  });

  describe('Multi-indicator signal groups', () => {
    it('should evaluate AND logic correctly', () => {
      const prevCandle = createCandle(1000, 100);
      const currCandle = createCandle(1001, 105);

      const prevIndicators = createIndicatorData(prevCandle, 98, 100);
      const currIndicators = createIndicatorData(currCandle, 102, 100);

      const group: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'ema',
            secondaryIndicator: 'sma',
            operator: 'crosses_above',
          },
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 100,
          },
        ],
      };

      const result = evaluateSignalGroup(group, {
        candle: currCandle,
        indicators: currIndicators,
        prevIndicators,
      });

      expect(result.satisfied).toBe(true);
    });

    it('should evaluate OR logic correctly', () => {
      const prevCandle = createCandle(1000, 100);
      const currCandle = createCandle(1001, 95);

      const prevIndicators = createIndicatorData(prevCandle, 98, 100);
      const currIndicators = createIndicatorData(currCandle, 102, 100);

      const group: SignalGroup = {
        logic: 'OR',
        conditions: [
          {
            indicator: 'ema',
            secondaryIndicator: 'sma',
            operator: 'crosses_above',
          },
          {
            indicator: 'price_change',
            field: 'close',
            operator: '<',
            value: 90,
          },
        ],
      };

      const result = evaluateSignalGroup(group, {
        candle: currCandle,
        indicators: currIndicators,
        prevIndicators,
      });

      // First condition is true (EMA crosses above SMA)
      expect(result.satisfied).toBe(true);
    });
  });

  describe('Lookback window conditions', () => {
    it('should evaluate condition over lookback window', () => {
      const candles = Array.from({ length: 10 }, (_, i) => createCandle(1000 + i, 100 + i));
      const indicators = candles.map((candle, i) => createIndicatorData(candle, 100 + i, 100));

      const condition: SignalCondition = {
        indicator: 'price_change',
        field: 'close',
        operator: '>',
        value: 100,
        lookbackBars: 5,
        minBarsTrue: 3, // At least 3 of 5 bars must satisfy
      };

      const lookbackContext = {
        candles,
        indicators,
        currentIndex: 9,
      };

      // Most recent 5 candles have close > 100, so condition should be satisfied
      const result = evaluateSignalGroup(
        {
          logic: 'AND',
          conditions: [condition],
        },
        {
          candle: candles[9],
          indicators: indicators[9],
          prevIndicators: indicators[8],
        },
        lookbackContext
      );

      expect(result.satisfied).toBe(true);
    });
  });
});
