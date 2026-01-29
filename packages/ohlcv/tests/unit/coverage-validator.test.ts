/**
 * Unit tests for Coverage Validator
 */

import { describe, it, expect } from 'vitest';
import {
  validateCoverage,
  intervalToMs,
  getCoverageStatus,
} from '../../src/coverage/validator.js';
import type { Candle } from '@quantbot/core';

describe('validateCoverage', () => {
  it('should detect gaps in candle data', () => {
    const candles: Candle[] = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      { timestamp: 2000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      // Gap: 3000-5000 missing
      { timestamp: 6000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
    ];

    const result = validateCoverage(candles, '1s', {
      from: '1970-01-01T00:00:01.000Z',
      to: '1970-01-01T00:00:06.000Z',
    });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].missingCandles).toBe(3);
    expect(result.coveragePercent).toBeCloseTo(50);
  });

  it('should handle complete coverage (no gaps)', () => {
    const candles: Candle[] = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      { timestamp: 2000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      { timestamp: 3000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
    ];

    const result = validateCoverage(candles, '1s', {
      from: '1970-01-01T00:00:01.000Z',
      to: '1970-01-01T00:00:03.000Z',
    });

    expect(result.gaps).toHaveLength(0);
    expect(result.coveragePercent).toBe(100);
  });

  it('should handle empty candle array', () => {
    const candles: Candle[] = [];

    const result = validateCoverage(candles, '1m', {
      from: '2025-05-01T00:00:00.000Z',
      to: '2025-05-01T01:00:00.000Z',
    });

    expect(result.actualCandles).toBe(0);
    expect(result.expectedCandles).toBe(61); // 60 minutes + 1
    expect(result.coveragePercent).toBe(0);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].missingCandles).toBe(61);
  });

  it('should detect gap at the start', () => {
    const candles: Candle[] = [
      // Missing first 5 seconds
      { timestamp: 6000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      { timestamp: 7000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
    ];

    const result = validateCoverage(candles, '1s', {
      from: '1970-01-01T00:00:01.000Z',
      to: '1970-01-01T00:00:07.000Z',
    });

    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps[0].from).toBe('1970-01-01T00:00:01.000Z');
  });

  it('should detect gap at the end', () => {
    const candles: Candle[] = [
      { timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      { timestamp: 2000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      // Missing last 5 seconds
    ];

    const result = validateCoverage(candles, '1s', {
      from: '1970-01-01T00:00:01.000Z',
      to: '1970-01-01T00:00:07.000Z',
    });

    expect(result.gaps.length).toBeGreaterThan(0);
    const lastGap = result.gaps[result.gaps.length - 1];
    expect(lastGap.to).toBe('1970-01-01T00:00:07.000Z');
  });
});

describe('intervalToMs', () => {
  it('should convert 1s to milliseconds', () => {
    expect(intervalToMs('1s')).toBe(1000);
  });

  it('should convert 1m to milliseconds', () => {
    expect(intervalToMs('1m')).toBe(60 * 1000);
  });

  it('should convert 5m to milliseconds', () => {
    expect(intervalToMs('5m')).toBe(5 * 60 * 1000);
  });

  it('should convert 1h to milliseconds', () => {
    expect(intervalToMs('1h')).toBe(60 * 60 * 1000);
  });

  it('should throw error for unsupported interval', () => {
    expect(() => intervalToMs('30s')).toThrow('Unsupported interval: 30s');
  });
});

describe('getCoverageStatus', () => {
  it('should return "good" for coverage >= 95%', () => {
    expect(getCoverageStatus(95)).toBe('good');
    expect(getCoverageStatus(100)).toBe('good');
  });

  it('should return "partial" for coverage 80-95%', () => {
    expect(getCoverageStatus(80)).toBe('partial');
    expect(getCoverageStatus(90)).toBe('partial');
    expect(getCoverageStatus(94.9)).toBe('partial');
  });

  it('should return "poor" for coverage < 80%', () => {
    expect(getCoverageStatus(79.9)).toBe('poor');
    expect(getCoverageStatus(50)).toBe('poor');
    expect(getCoverageStatus(0)).toBe('poor');
  });
});

