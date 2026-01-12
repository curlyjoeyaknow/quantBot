/**
 * Candle validation tests.
 *
 * Tests corruption detection and quality validation.
 * Corruption checks are ALWAYS enforced (non-configurable).
 * Quality checks are configurable via options.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCandle,
  validateCandleBatch,
  ValidationSeverity,
  STRICT_VALIDATION,
  LENIENT_VALIDATION,
} from '../../src/clickhouse/validation/candle-validator.js';
import type { Candle } from '@quantbot/core';

describe('validateCandle - Corruption Detection', () => {
  it('should detect INVALID_RANGE (high < low)', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 90, // Invalid: high < low
      low: 110,
      close: 100,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasCorruption).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.CORRUPTION,
        code: 'INVALID_RANGE',
      })
    );
  });

  it('should detect OPEN_OUTSIDE_RANGE', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 120, // Outside [90, 110]
      high: 110,
      low: 90,
      close: 100,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasCorruption).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.CORRUPTION,
        code: 'OPEN_OUTSIDE_RANGE',
      })
    );
  });

  it('should detect CLOSE_OUTSIDE_RANGE', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 80, // Outside [90, 110]
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasCorruption).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.CORRUPTION,
        code: 'CLOSE_OUTSIDE_RANGE',
      })
    );
  });

  it('should detect NEGATIVE_VALUES', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: -100, // Negative
      high: 110,
      low: 90,
      close: 100,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasCorruption).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.CORRUPTION,
        code: 'NEGATIVE_VALUES',
      })
    );
  });

  it('should reject candle with any corruption', () => {
    const corruptedCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 90, // Corruption
      low: 110,
      close: 100,
      volume: 1000,
    };

    const result = validateCandle(corruptedCandle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasCorruption).toBe(true);
  });
});

describe('validateCandle - Quality Checks (STRICT)', () => {
  it('should reject ZERO_VOLUME in strict mode', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 0, // Zero volume
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasQualityIssues).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.QUALITY,
        code: 'ZERO_VOLUME',
      })
    );
  });

  it('should reject ZERO_PRICE in strict mode', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 0, // Zero price
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasQualityIssues).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.QUALITY,
        code: 'ZERO_OPEN',
      })
    );
  });

  it('should reject FUTURE_TIMESTAMP beyond tolerance', () => {
    const nowMs = Date.now();
    const futureMs = nowMs + 600000; // 10 minutes ahead (beyond 5-minute tolerance)

    const candle: Candle = {
      timestamp: Math.floor(futureMs / 1000), // Convert to seconds
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION, nowMs);

    expect(result.valid).toBe(false);
    expect(result.hasQualityIssues).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.QUALITY,
        code: 'FUTURE_TIMESTAMP',
      })
    );
  });

  it('should allow future timestamp within tolerance', () => {
    const nowMs = Date.now();
    const futureMs = nowMs + 60000; // 1 minute ahead (within 5-minute tolerance)

    const candle: Candle = {
      timestamp: Math.floor(futureMs / 1000),
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION, nowMs);

    expect(result.valid).toBe(true);
  });
});

describe('validateCandle - Quality Checks (LENIENT)', () => {
  it('should allow ZERO_VOLUME in lenient mode (WARNING)', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 0,
    };

    const result = validateCandle(candle, LENIENT_VALIDATION);

    // Still valid (not rejected)
    expect(result.valid).toBe(true);
    expect(result.hasQualityIssues).toBe(false);

    // But has warning
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: ValidationSeverity.WARNING,
        code: 'ZERO_VOLUME',
      })
    );
  });

  it('should still reject ZERO_PRICE in lenient mode', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 0,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const result = validateCandle(candle, LENIENT_VALIDATION);

    expect(result.valid).toBe(false);
    expect(result.hasQualityIssues).toBe(true);
  });
});

describe('validateCandle - Valid Candles', () => {
  it('should accept perfect candle', () => {
    const candle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000,
    };

    const result = validateCandle(candle, STRICT_VALIDATION);

    expect(result.valid).toBe(true);
    expect(result.hasCorruption).toBe(false);
    expect(result.hasQualityIssues).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it('should accept edge case: open = high = low = close (flat candle)', () => {
    const flatCandle: Candle = {
      timestamp: 1000,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1000,
    };

    const result = validateCandle(flatCandle, STRICT_VALIDATION);

    expect(result.valid).toBe(true);
  });

  it('should accept edge case: open = high, close = low', () => {
    const bearishCandle: Candle = {
      timestamp: 1000,
      open: 110,
      high: 110,
      low: 90,
      close: 90,
      volume: 1000,
    };

    const result = validateCandle(bearishCandle, STRICT_VALIDATION);

    expect(result.valid).toBe(true);
  });
});

describe('validateCandleBatch', () => {
  it('should separate valid and rejected candles', () => {
    const candles: Candle[] = [
      // Valid
      {
        timestamp: 1000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
      },
      // Invalid: high < low
      {
        timestamp: 2000,
        open: 100,
        high: 90,
        low: 110,
        close: 100,
        volume: 1000,
      },
      // Valid
      {
        timestamp: 3000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
      },
    ];

    const result = validateCandleBatch(candles, STRICT_VALIDATION);

    expect(result.valid).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].candle.timestamp).toBe(2000);
    expect(result.rejected[0].errors).toContain(expect.stringContaining('INVALID_RANGE'));
  });

  it('should count warnings', () => {
    const candles: Candle[] = [
      // Valid but with warning (zero volume)
      {
        timestamp: 1000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 0,
      },
      // Valid
      {
        timestamp: 2000,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
      },
    ];

    const result = validateCandleBatch(candles, LENIENT_VALIDATION);

    expect(result.valid).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    expect(result.warningCount).toBe(1); // One candle has zero volume warning
  });
});

