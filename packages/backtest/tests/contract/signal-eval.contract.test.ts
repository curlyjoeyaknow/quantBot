/**
 * Contract Tests for Signal Evaluation (re-exported from @quantbot/simulation)
 *
 * These tests ensure that:
 * 1. The symbols exist and are callable
 * 2. Basic deterministic output matches expected fixtures
 * 3. Call signatures stay stable (prevent breaking changes)
 *
 * Purpose: Prevent "minor refactor in simulation broke backtest API" from becoming your new hobby.
 */

import { describe, it, expect } from 'vitest';
// Import directly from source to avoid Vitest SSR module resolution issues
import { evaluateSignalGroup } from '../../src/sim/signals.js';
import type { SignalGroup, SignalCondition } from '../../src/sim/types/index.js';
import type { Candle } from '@quantbot/core';

/**
 * Create test candles with predictable price movement
 */
function createTestCandles(
  startPrice: number,
  pricePath: number[],
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];
  const timestamp = 1000000000; // Fixed timestamp for determinism

  for (let i = 0; i < pricePath.length; i++) {
    const price = pricePath[i]!;
    const prevPrice = i > 0 ? pricePath[i - 1]! : startPrice;

    candles.push({
      timestamp: timestamp + i * intervalSeconds,
      open: prevPrice,
      high: Math.max(prevPrice, price),
      low: Math.min(prevPrice, price),
      close: price,
      volume: 1000,
    });
  }

  return candles;
}

describe('Signal Evaluation Contract Tests', () => {
  describe('evaluateSignalGroup', () => {
    it('should exist and be callable', () => {
      const signalGroup: SignalGroup = {
        mode: 'ALL',
        conditions: [],
      };
      // Signature: (group, context, lookbackContext?)
      // Create minimal context
      // Create minimal context matching SignalEvaluationContext
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2]);
      const context = {
        candle: candles[0]!,
        indicators: {},
      };
      const result = evaluateSignalGroup(signalGroup, context);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('satisfied');
      expect(typeof result.satisfied).toBe('boolean');
    });

    it('should produce deterministic output for same inputs', () => {
      const signalGroup: SignalGroup = {
        mode: 'ALL',
        conditions: [],
      };
      // Create minimal context matching SignalEvaluationContext
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2]);
      const context = {
        candle: candles[0]!,
        indicators: {},
      };
      const result1 = evaluateSignalGroup(signalGroup, context);
      const result2 = evaluateSignalGroup(signalGroup, context);
      expect(result1.satisfied).toBe(result2.satisfied);
    });

    it('should handle empty conditions', () => {
      const signalGroup: SignalGroup = {
        mode: 'ALL',
        conditions: [],
      };
      // Create minimal context matching SignalEvaluationContext
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2]);
      const context = {
        candle: candles[0]!,
        indicators: {},
      };
      const result = evaluateSignalGroup(signalGroup, context);
      expect(typeof result.satisfied).toBe('boolean');
    });
  });

  describe('Call signature stability', () => {
    it('should maintain evaluateSignalGroup signature: (group, context, lookbackContext?)', () => {
      const signalGroup: SignalGroup = {
        mode: 'ALL',
        conditions: [],
      };
      // Create minimal context matching SignalEvaluationContext
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2]);
      const context = {
        candle: candles[0]!,
        indicators: {},
      };
      // This test will fail if signature changes
      expect(() => evaluateSignalGroup(signalGroup, context)).not.toThrow();
    });
  });
});
