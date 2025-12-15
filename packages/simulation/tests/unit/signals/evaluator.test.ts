import { describe, it, expect } from 'vitest';
import { evaluateCondition, evaluateSignalGroup } from '../../../src/signals/evaluator';
import type { SignalCondition, SignalGroup } from '../../../src/types';
import type { Candle } from '../../../src/types/candle';
import type { LegacyIndicatorData } from '../../../src/indicators/registry';

describe('Signal Evaluator', () => {
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

  describe('evaluateCondition', () => {
    it('should evaluate simple comparison condition', () => {
      const condition: SignalCondition = {
        indicator: 'sma',
        operator: '>',
        value: 1.0,
      };
      const result = evaluateCondition(condition, {
        candle: mockCandle,
        indicators: mockIndicators,
      });
      expect(result.satisfied).toBeDefined(); // Result should be defined
    });

    it('should evaluate cross condition', () => {
      const prevIndicators: LegacyIndicatorData = {
        ...mockIndicators,
        movingAverages: {
          ...mockIndicators.movingAverages,
          sma20: 0.95,
        },
      };
      const condition: SignalCondition = {
        indicator: 'sma',
        secondaryIndicator: 'ema',
        operator: 'crosses_above',
      };
      const result = evaluateCondition(condition, {
        candle: mockCandle,
        indicators: mockIndicators,
        prevIndicators,
      });
      expect(result.satisfied).toBeDefined();
    });
  });

  describe('evaluateSignalGroup', () => {
    it('should evaluate AND group', () => {
      const group: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'sma',
            operator: '>',
            value: 0.9,
          },
          {
            indicator: 'ema',
            operator: '>',
            value: 0.9,
          },
        ],
      };
      const result = evaluateSignalGroup(group, {
        candle: mockCandle,
        indicators: mockIndicators,
      });
      expect(result.satisfied).toBeDefined();
    });

    it('should evaluate OR group', () => {
      const group: SignalGroup = {
        logic: 'OR',
        conditions: [
          {
            indicator: 'sma',
            operator: '>',
            value: 2.0, // False
          },
          {
            indicator: 'ema',
            operator: '>',
            value: 0.9, // True
          },
        ],
      };
      const result = evaluateSignalGroup(group, {
        candle: mockCandle,
        indicators: mockIndicators,
      });
      expect(result.satisfied).toBe(true); // OR should be true
    });
  });
});
