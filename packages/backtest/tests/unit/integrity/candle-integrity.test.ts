/**
 * Tests for candle integrity checks
 */

import { describe, it, expect } from 'vitest';
import {
  checkCandleIntegrity,
  type IntegrityCheckConfig,
} from '../../../src/integrity/candle-integrity.js';
import type { Candle } from '@quantbot/core';

describe('checkCandleIntegrity', () => {
  const baseConfig: IntegrityCheckConfig = {
    expectedIntervalMs: 300000, // 5 minutes
    maxGapIntervals: 10,
    priceSpikeThreshold: 0.5,
    volumeSpikeThreshold: 2.0,
    minVolume: 0,
  };

  it('should pass for valid candle sequence', () => {
    const candles: Candle[] = [];
    const startTs = 1000000000000; // Base timestamp
    for (let i = 0; i < 100; i++) {
      candles.push({
        timestamp: startTs + i * 300000, // 5 minute intervals
        open: 100 + i * 0.1,
        high: 101 + i * 0.1,
        low: 99 + i * 0.1,
        close: 100.5 + i * 0.1,
        volume: 1000 + i * 10,
      });
    }

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('should detect duplicate timestamps', () => {
    const candles: Candle[] = [
      {
        timestamp: 1000000000000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000000000, // Duplicate
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000300000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
    ];

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.passed).toBe(false);
    expect(result.summary.duplicateCount).toBe(1);
    expect(result.issues.some((i) => i.type === 'duplicate')).toBe(true);
  });

  it('should detect timestamp gaps', () => {
    const candles: Candle[] = [
      {
        timestamp: 1000000000000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000000000 + 300000 * 15, // 15 intervals gap (exceeds max of 10)
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
    ];

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.summary.gapCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'gap')).toBe(true);
  });

  it('should detect price anomalies (zero/negative prices)', () => {
    const candles: Candle[] = [
      {
        timestamp: 1000000000000,
        open: 0, // Zero price
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000300000,
        open: -10, // Negative price
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
    ];

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.passed).toBe(false);
    expect(result.summary.priceAnomalyCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'price_anomaly')).toBe(true);
  });

  it('should detect price spikes', () => {
    const candles: Candle[] = [
      {
        timestamp: 1000000000000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000300000,
        open: 200, // 100% spike (exceeds 50% threshold)
        high: 201,
        low: 199,
        close: 200.5,
        volume: 1000,
      },
    ];

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.summary.priceAnomalyCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'price_anomaly')).toBe(true);
  });

  it('should detect OHLC consistency violations', () => {
    const candles: Candle[] = [
      {
        timestamp: 1000000000000,
        open: 100,
        high: 99, // High < Low (violation)
        low: 100,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000300000,
        open: 200, // Open outside [low, high]
        high: 201,
        low: 199,
        close: 200.5,
        volume: 1000,
      },
    ];

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.passed).toBe(false);
    expect(result.summary.ohlcViolationCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'ohlc_violation')).toBe(true);
  });

  it('should detect volume anomalies', () => {
    const candles: Candle[] = [];
    const startTs = 1000000000000;
    for (let i = 0; i < 10; i++) {
      candles.push({
        timestamp: startTs + i * 300000,
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000, // Normal volume
      });
    }
    // Add spike
    candles.push({
      timestamp: startTs + 10 * 300000,
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 5000, // 5x average (exceeds 2x threshold)
    });

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.summary.volumeAnomalyCount).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.type === 'volume_anomaly')).toBe(true);
  });

  it('should handle empty candle array', () => {
    const result = checkCandleIntegrity([], baseConfig);
    expect(result.passed).toBe(false);
    expect(result.summary.totalCandles).toBe(0);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should calculate correct summary statistics', () => {
    const candles: Candle[] = [
      {
        timestamp: 1000000000000,
        open: 0, // Price anomaly
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000000000, // Duplicate
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1000,
      },
      {
        timestamp: 1000000000000 + 300000 * 15, // Gap
        open: 100,
        high: 99, // OHLC violation
        low: 100,
        close: 100.5,
        volume: 1000,
      },
    ];

    const result = checkCandleIntegrity(candles, baseConfig);
    expect(result.summary.totalCandles).toBe(3);
    expect(result.summary.duplicateCount).toBeGreaterThan(0);
    expect(result.summary.gapCount).toBeGreaterThan(0);
    expect(result.summary.priceAnomalyCount).toBeGreaterThan(0);
    expect(result.summary.ohlcViolationCount).toBeGreaterThan(0);
    expect(result.summary.criticalIssues).toBeGreaterThan(0);
  });
});
