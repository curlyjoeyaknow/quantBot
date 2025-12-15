import { describe, it, expect } from 'vitest';
import { getIndicatorValue, isIndicatorReady } from '../../../src/indicators/base';
import type { IndicatorResult } from '../../../src/indicators/base';

describe('Indicator Base Utilities', () => {
  describe('getIndicatorValue', () => {
    it('should get primary value', () => {
      const result: IndicatorResult = {
        name: 'sma',
        value: 1.5,
        fields: {},
        ready: true,
      };
      const value = getIndicatorValue(result);
      expect(value).toBe(1.5);
    });

    it('should get field value', () => {
      const result: IndicatorResult = {
        name: 'ichimoku',
        value: null,
        fields: { tenkan: 1.2, kijun: 1.1 },
        ready: true,
      };
      const value = getIndicatorValue(result, 'tenkan');
      expect(value).toBe(1.2);
    });

    it('should return null for missing field', () => {
      const result: IndicatorResult = {
        name: 'sma',
        value: 1.5,
        fields: {},
        ready: true,
      };
      const value = getIndicatorValue(result, 'nonexistent');
      expect(value).toBeNull();
    });
  });

  describe('isIndicatorReady', () => {
    it('should return true for ready indicator with value', () => {
      const result: IndicatorResult = {
        name: 'sma',
        value: 1.5,
        fields: {},
        ready: true,
      };
      expect(isIndicatorReady(result)).toBe(true);
    });

    it('should return false for not ready indicator', () => {
      const result: IndicatorResult = {
        name: 'sma',
        value: null,
        fields: {},
        ready: false,
      };
      expect(isIndicatorReady(result)).toBe(false);
    });

    it('should return false for ready but null value', () => {
      const result: IndicatorResult = {
        name: 'sma',
        value: null,
        fields: {},
        ready: true,
      };
      expect(isIndicatorReady(result)).toBe(false);
    });
  });
});
