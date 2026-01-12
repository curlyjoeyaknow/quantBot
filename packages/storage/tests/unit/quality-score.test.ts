/**
 * Quality score computation tests.
 *
 * Tests the data-derived quality scoring system that ensures
 * candles with volume always beat candles without volume.
 */

import { describe, it, expect } from 'vitest';
import {
  computeQualityScore,
  computeQualityScoreWithBreakdown,
  SourceTier,
} from '../../src/clickhouse/types/quality-score.js';
import type { Candle } from '@quantbot/core';

describe('computeQualityScore', () => {
  it('should give +100 points for volume > 0', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const score = computeQualityScore(candle, SourceTier.UNKNOWN);
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('should give 0 points for volume = 0', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 0,
    };

    const score = computeQualityScore(candle, SourceTier.CANONICAL);
    // Even CANONICAL source tier (5 points) can't reach 100 without volume
    expect(score).toBeLessThan(100);
  });

  it('should guarantee volume-based candle beats no-volume candle', () => {
    // Worst-quality candle WITH volume (corrupted but has volume)
    const volumeCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 90, // Invalid: high < low
      low: 110,
      close: 120, // Invalid: close outside range
      volume: 1,
    };

    // Perfect-quality candle WITHOUT volume (from CANONICAL source)
    const noVolumeCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 0,
    };

    const volumeScore = computeQualityScore(volumeCandle, SourceTier.UNKNOWN);
    const noVolumeScore = computeQualityScore(noVolumeCandle, SourceTier.CANONICAL);

    // Volume candle MUST win
    expect(volumeScore).toBeGreaterThan(noVolumeScore);
  });

  it('should add +10 points for valid range (high >= low)', () => {
    const validRangeCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const invalidRangeCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 90, // Invalid: high < low
      low: 110,
      close: 100,
      volume: 1000,
    };

    const validScore = computeQualityScore(validRangeCandle, SourceTier.UNKNOWN);
    const invalidScore = computeQualityScore(invalidRangeCandle, SourceTier.UNKNOWN);

    // Valid: 100 (volume) + 10 (range) + 5 (open) + 5 (close) + 0 (tier) = 120
    // Invalid: 100 (volume) + 0 (range) + 0 (open outside inverted range) + 0 (close outside inverted range) + 0 (tier) = 100
    expect(validScore).toBe(120);
    expect(invalidScore).toBe(100);
    expect(validScore).toBe(invalidScore + 20); // 10 for range + 10 for consistent OHLC
  });

  it('should add +5 points for consistent open (within range)', () => {
    const consistentOpen: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const inconsistentOpen: Candle = {
      timestamp: 1000,
      open: 120, // Outside [90, 110]
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const consistentScore = computeQualityScore(consistentOpen, SourceTier.UNKNOWN);
    const inconsistentScore = computeQualityScore(inconsistentOpen, SourceTier.UNKNOWN);

    expect(consistentScore).toBe(inconsistentScore + 5);
  });

  it('should add +5 points for consistent close (within range)', () => {
    const consistentClose: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const inconsistentClose: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 120, // Outside [90, 110]
      volume: 1000,
    };

    const consistentScore = computeQualityScore(consistentClose, SourceTier.UNKNOWN);
    const inconsistentScore = computeQualityScore(inconsistentClose, SourceTier.UNKNOWN);

    expect(consistentScore).toBe(inconsistentScore + 5);
  });

  it('should use source tier as tie-breaker (0-5 points)', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const unknownScore = computeQualityScore(candle, SourceTier.UNKNOWN); // +0
    const canonicalScore = computeQualityScore(candle, SourceTier.CANONICAL); // +5

    expect(canonicalScore).toBe(unknownScore + 5);
  });

  it('should compute maximum possible score (125)', () => {
    const perfectCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const maxScore = computeQualityScore(perfectCandle, SourceTier.CANONICAL);
    // 100 (volume) + 10 (range) + 5 (open) + 5 (close) + 5 (canonical) = 125
    expect(maxScore).toBe(125);
  });

  it('should compute minimum possible score (0)', () => {
    const garbageCandle: Candle = {
      timestamp: 1000,
      open: 200, // Outside range
      high: 90, // Invalid: high < low
      low: 110,
      close: 300, // Outside range
      volume: 0, // No volume
    };

    const minScore = computeQualityScore(garbageCandle, SourceTier.UNKNOWN);
    expect(minScore).toBe(0);
  });
});

describe('computeQualityScoreWithBreakdown', () => {
  it('should provide detailed breakdown of score components', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const breakdown = computeQualityScoreWithBreakdown(candle, SourceTier.BACKFILL_API);

    expect(breakdown.hasVolume).toBe(true);
    expect(breakdown.validRange).toBe(true);
    expect(breakdown.consistentOpen).toBe(true);
    expect(breakdown.consistentClose).toBe(true);
    expect(breakdown.sourceTier).toBe(SourceTier.BACKFILL_API);
    expect(breakdown.totalScore).toBe(122); // 100+10+5+5+2
  });

  it('should show false flags for invalid candle', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 200, // Outside range
      high: 90, // Invalid: high < low
      low: 110,
      close: 300, // Outside range
      volume: 0,
    };

    const breakdown = computeQualityScoreWithBreakdown(candle, SourceTier.UNKNOWN);

    expect(breakdown.hasVolume).toBe(false);
    expect(breakdown.validRange).toBe(false);
    expect(breakdown.consistentOpen).toBe(false);
    expect(breakdown.consistentClose).toBe(false);
    expect(breakdown.sourceTier).toBe(SourceTier.UNKNOWN);
    expect(breakdown.totalScore).toBe(0);
  });
});
