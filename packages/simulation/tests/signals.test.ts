import { describe, it, expect } from 'vitest';
import {
  evaluateSignalGroup,
  evaluateSignalCondition,
  evaluateLadderLegs,
  type SignalEvaluationContext,
} from '../src/signals';
import type { Candle } from '../src/candles';
import type { IndicatorData } from '../src/indicators';
import type { SignalGroup, SignalCondition, LadderConfig } from '../src/config';

describe('signals', () => {
  const createMockCandle = (overrides?: Partial<Candle>): Candle => ({
    timestamp: 1000,
    open: 1.0,
    high: 1.1,
    low: 0.9,
    close: 1.05,
    volume: 1000,
    ...overrides,
  });

  const createMockIndicators = (overrides?: Partial<IndicatorData>): IndicatorData => ({
    candle: createMockCandle(),
    movingAverages: {
      sma20: 1.0,
      ema20: 1.0,
    },
    ichimoku: {
      tenkan: 1.0,
      kijun: 1.0,
      span_a: 1.0,
      span_b: 1.0,
      isBullish: true,
      isBearish: false,
    },
    ...overrides,
  });

  const createContext = (
    candle?: Candle,
    indicators?: IndicatorData,
    prevIndicators?: IndicatorData | null
  ): SignalEvaluationContext => ({
    candle: candle ?? createMockCandle(),
    indicators: indicators ?? createMockIndicators(),
    prevIndicators: prevIndicators ?? null,
  });

  describe('evaluateSignalCondition', () => {
    it('should evaluate simple greater than condition', () => {
      const condition: SignalCondition = {
        indicator: 'price_change',
        field: 'close',
        operator: '>',
        value: 1.0,
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({ candle: createMockCandle({ close: 1.05 }) })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
      expect(result.condition).toBe(condition);
    });

    it('should evaluate less than condition', () => {
      const condition: SignalCondition = {
        indicator: 'price_change',
        field: 'close',
        operator: '<',
        value: 1.0,
      };

      const context = createContext(
        createMockCandle({ close: 0.95 }),
        createMockIndicators({ candle: createMockCandle({ close: 0.95 }) })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate equals condition', () => {
      const condition: SignalCondition = {
        indicator: 'price_change',
        field: 'close',
        operator: '==',
        value: 1.05,
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({ candle: createMockCandle({ close: 1.05 }) })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate SMA indicator condition', () => {
      const condition: SignalCondition = {
        indicator: 'sma',
        operator: '>',
        value: 0.9,
      };

      const context = createContext(
        undefined,
        createMockIndicators({ movingAverages: { sma20: 1.0, ema20: 1.0 } })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate EMA indicator condition', () => {
      const condition: SignalCondition = {
        indicator: 'ema',
        operator: '>=',
        value: 1.0,
      };

      const context = createContext(
        undefined,
        createMockIndicators({ movingAverages: { sma20: 1.0, ema20: 1.0 } })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate Ichimoku tenkan condition', () => {
      const condition: SignalCondition = {
        indicator: 'ichimoku_cloud',
        field: 'tenkan',
        operator: '>',
        value: 0.9,
      };

      const context = createContext(
        undefined,
        createMockIndicators({
          ichimoku: {
            tenkan: 1.0,
            kijun: 1.0,
            span_a: 1.0,
            span_b: 1.0,
            isBullish: true,
            isBearish: false,
          },
        })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate crosses_above condition', () => {
      const condition: SignalCondition = {
        indicator: 'sma',
        operator: 'crosses_above',
        secondaryIndicator: 'ema',
      };

      const prevIndicators = createMockIndicators({
        movingAverages: { sma20: 0.9, ema20: 1.0 },
      });

      const currentIndicators = createMockIndicators({
        movingAverages: { sma20: 1.1, ema20: 1.0 },
      });

      const context = createContext(undefined, currentIndicators, prevIndicators);

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate crosses_below condition', () => {
      const condition: SignalCondition = {
        indicator: 'sma',
        operator: 'crosses_below',
        secondaryIndicator: 'ema',
      };

      const prevIndicators = createMockIndicators({
        movingAverages: { sma20: 1.1, ema20: 1.0 },
      });

      const currentIndicators = createMockIndicators({
        movingAverages: { sma20: 0.9, ema20: 1.0 },
      });

      const context = createContext(undefined, currentIndicators, prevIndicators);

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(true);
    });

    it('should return false for undefined indicator values', () => {
      const condition: SignalCondition = {
        indicator: 'sma',
        operator: '>',
        value: 1.0,
      };

      const context = createContext(
        undefined,
        createMockIndicators({ movingAverages: { sma20: undefined, ema20: 1.0 } })
      );

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(false);
    });

    it('should return false for missing previous indicators in cross conditions', () => {
      const condition: SignalCondition = {
        indicator: 'sma',
        operator: 'crosses_above',
        secondaryIndicator: 'ema',
      };

      const context = createContext(undefined, createMockIndicators(), null);

      const result = evaluateSignalCondition(condition, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('evaluateSignalGroup', () => {
    it('should evaluate AND group with all conditions satisfied', () => {
      const group: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 1.0,
          },
          {
            indicator: 'sma',
            operator: '>',
            value: 0.9,
          },
        ],
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({
          candle: createMockCandle({ close: 1.05 }),
          movingAverages: { sma20: 1.0, ema20: 1.0 },
        })
      );

      const result = evaluateSignalGroup(group, context);
      expect(result.satisfied).toBe(true);
      expect(result.children).toHaveLength(2);
    });

    it('should evaluate AND group with one condition not satisfied', () => {
      const group: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 1.0,
          },
          {
            indicator: 'sma',
            operator: '<',
            value: 0.5,
          },
        ],
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({
          candle: createMockCandle({ close: 1.05 }),
          movingAverages: { sma20: 1.0, ema20: 1.0 },
        })
      );

      const result = evaluateSignalGroup(group, context);
      expect(result.satisfied).toBe(false);
    });

    it('should evaluate OR group with one condition satisfied', () => {
      const group: SignalGroup = {
        logic: 'OR',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '<',
            value: 0.5,
          },
          {
            indicator: 'sma',
            operator: '>',
            value: 0.9,
          },
        ],
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({
          candle: createMockCandle({ close: 1.05 }),
          movingAverages: { sma20: 1.0, ema20: 1.0 },
        })
      );

      const result = evaluateSignalGroup(group, context);
      expect(result.satisfied).toBe(true);
    });

    it('should evaluate nested groups', () => {
      const group: SignalGroup = {
        logic: 'AND',
        conditions: [
          {
            indicator: 'price_change',
            field: 'close',
            operator: '>',
            value: 1.0,
          },
        ],
        groups: [
          {
            logic: 'OR',
            conditions: [
              {
                indicator: 'sma',
                operator: '>',
                value: 0.9,
              },
            ],
          },
        ],
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({
          candle: createMockCandle({ close: 1.05 }),
          movingAverages: { sma20: 1.0, ema20: 1.0 },
        })
      );

      const result = evaluateSignalGroup(group, context);
      expect(result.satisfied).toBe(true);
      expect(result.children).toHaveLength(2);
    });

    it('should return false for empty group', () => {
      const group: SignalGroup = {
        logic: 'AND',
        conditions: [],
        groups: [],
      };

      const context = createContext();
      const result = evaluateSignalGroup(group, context);
      expect(result.satisfied).toBe(false);
    });
  });

  describe('evaluateLadderLegs', () => {
    it('should return all legs without signals', () => {
      const ladder: LadderConfig = {
        sequential: false,
        legs: [
          { sizePercent: 0.5, id: 'leg1' },
          { sizePercent: 0.5, id: 'leg2' },
        ],
      };

      const context = createContext();
      const alreadyFilled = new Set<string>();

      const result = evaluateLadderLegs(ladder, context, alreadyFilled);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('leg1');
      expect(result[1].id).toBe('leg2');
    });

    it('should filter out already filled legs', () => {
      const ladder: LadderConfig = {
        sequential: false,
        legs: [
          { sizePercent: 0.5, id: 'leg1' },
          { sizePercent: 0.5, id: 'leg2' },
        ],
      };

      const context = createContext();
      const alreadyFilled = new Set<string>(['leg1']);

      const result = evaluateLadderLegs(ladder, context, alreadyFilled);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('leg2');
    });

    it('should evaluate legs with signals', () => {
      const ladder: LadderConfig = {
        sequential: false,
        legs: [
          {
            sizePercent: 0.5,
            id: 'leg1',
            signal: {
              logic: 'AND',
              conditions: [
                {
                  indicator: 'price_change',
                  field: 'close',
                  operator: '>',
                  value: 1.0,
                },
              ],
            },
          },
          { sizePercent: 0.5, id: 'leg2' },
        ],
      };

      const context = createContext(
        createMockCandle({ close: 1.05 }),
        createMockIndicators({ candle: createMockCandle({ close: 1.05 }) })
      );

      const alreadyFilled = new Set<string>();
      const result = evaluateLadderLegs(ladder, context, alreadyFilled);
      expect(result).toHaveLength(2);
    });

    it('should stop at first leg in sequential mode', () => {
      const ladder: LadderConfig = {
        sequential: true,
        legs: [
          { sizePercent: 0.5, id: 'leg1' },
          { sizePercent: 0.5, id: 'leg2' },
        ],
      };

      const context = createContext();
      const alreadyFilled = new Set<string>();

      const result = evaluateLadderLegs(ladder, context, alreadyFilled);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('leg1');
    });

    it('should generate leg ID from properties if not provided', () => {
      const ladder: LadderConfig = {
        sequential: false,
        legs: [
          { sizePercent: 0.5, priceOffset: 0.1 },
          { sizePercent: 0.3, multiple: 2 },
        ],
      };

      const context = createContext();
      const alreadyFilled = new Set<string>();

      const result = evaluateLadderLegs(ladder, context, alreadyFilled);
      expect(result).toHaveLength(2);
      expect(result[0].sizePercent).toBe(0.5);
      expect(result[1].sizePercent).toBe(0.3);
    });
  });
});
