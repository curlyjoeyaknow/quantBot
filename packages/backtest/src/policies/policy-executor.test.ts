/**
 * Policy Executor Tests (Phase 4 - MVP 2)
 *
 * Tests for policy execution with invariants:
 * - realizedReturnBps <= peakMultiple * 10000 (can't exceed peak)
 * - tailCapture <= 1.0 (can't capture more than peak)
 * - Stop-out is correctly detected
 */

import { describe, it, expect } from 'vitest';
import type { Candle } from '@quantbot/core';
import { executePolicy } from './policy-executor.js';
import type {
  FixedStopPolicy,
  TimeStopPolicy,
  TrailingStopPolicy,
  LadderPolicy,
} from './risk-policy.js';

// =============================================================================
// Test Utilities
// =============================================================================

function createCandles(
  startTs: number,
  prices: Array<{ open: number; high: number; low: number; close: number }>
): Candle[] {
  return prices.map((p, i) => ({
    timestamp: startTs / 1000 + i * 60, // 1-minute intervals, convert to seconds
    open: p.open,
    high: p.high,
    low: p.low,
    close: p.close,
    volume: 1000,
  }));
}

// =============================================================================
// Fixed Stop Policy Tests
// =============================================================================

describe('executePolicy - Fixed Stop', () => {
  const policy: FixedStopPolicy = {
    kind: 'fixed_stop',
    stopPct: 0.2, // 20% stop
    takeProfitPct: 1.0, // 100% take profit
  };

  it('triggers stop loss when price drops below threshold', () => {
    const startTs = 1704067200000; // 2024-01-01 00:00:00 UTC
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.1, low: 1.0, close: 1.0 }, // Entry at 1.0
      { open: 1.0, high: 1.0, low: 0.75, close: 0.9 }, // Low 0.75 <= 0.8 (stop triggers)
      { open: 0.9, high: 1.0, low: 0.9, close: 1.0 }, // Should not reach
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.stopOut).toBe(true);
    expect(result.exitReason).toBe('stop_loss');
    expect(result.exitPx).toBe(0.8); // Stop price
  });

  it('triggers take profit when price doubles', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // Entry
      { open: 1.0, high: 1.5, low: 0.9, close: 1.3 },
      { open: 1.3, high: 2.1, low: 1.2, close: 2.0 }, // Hit 2x
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.stopOut).toBe(false);
    expect(result.exitReason).toBe('take_profit');
    expect(result.exitPx).toBe(2.0); // 2x entry price
  });

  it('exits at end of data when neither stop nor take profit hit', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // Entry
      { open: 1.0, high: 1.2, low: 0.9, close: 1.1 }, // No stop, no TP
      { open: 1.1, high: 1.3, low: 1.0, close: 1.2 }, // No stop, no TP
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.stopOut).toBe(false);
    expect(result.exitReason).toBe('end_of_data');
    expect(result.exitPx).toBe(1.2); // Last close
  });

  // INVARIANT: realized return cannot exceed peak
  it('invariant: realized return <= peak return', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 2.5, low: 0.9, close: 2.0 },
      { open: 2.0, high: 3.0, low: 1.8, close: 2.5 },
    ]);

    const result = executePolicy(candles, startTs, policy);

    // Peak is 3.0, so peak return is 200% (20000 bps)
    // Realized should not exceed peak
    const peakReturnBps = (3.0 / 1.0 - 1) * 10000; // 20000
    expect(result.realizedReturnBps).toBeLessThanOrEqual(peakReturnBps);
  });

  // INVARIANT: tail capture <= 1.0
  it('invariant: tail capture <= 1.0', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 2.0, low: 0.9, close: 1.5 },
    ]);

    const result = executePolicy(candles, startTs, policy);

    if (result.tailCapture !== null) {
      expect(result.tailCapture).toBeLessThanOrEqual(1.0);
    }
  });
});

// =============================================================================
// Time Stop Policy Tests
// =============================================================================

describe('executePolicy - Time Stop', () => {
  const policy: TimeStopPolicy = {
    kind: 'time_stop',
    maxHoldMs: 2 * 60 * 1000, // 2 minutes
  };

  it('triggers time stop after max hold time', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // Entry at t=0
      { open: 1.0, high: 1.1, low: 0.95, close: 1.05 }, // t=60s
      { open: 1.05, high: 1.15, low: 1.0, close: 1.1 }, // t=120s (time stop)
      { open: 1.1, high: 1.5, low: 1.0, close: 1.4 }, // Should not reach
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.exitReason).toBe('time_stop');
    expect(result.timeExposedMs).toBeLessThanOrEqual(2 * 60 * 1000 + 60000); // Allow for candle granularity
  });

  it('does not trigger time stop before max hold', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // t=0
      { open: 1.0, high: 1.1, low: 0.95, close: 1.05 }, // t=60s, only 1 min elapsed
    ]);

    const result = executePolicy(candles, startTs, policy);

    // With only 1 minute elapsed and 2 min max hold, should exit at end of data
    expect(result.exitReason).toBe('end_of_data');
  });
});

// =============================================================================
// Trailing Stop Policy Tests
// =============================================================================

describe('executePolicy - Trailing Stop', () => {
  const policy: TrailingStopPolicy = {
    kind: 'trailing_stop',
    activationPct: 0.2, // Activate after 20% gain
    trailPct: 0.1, // Trail 10% from peak
    hardStopPct: 0.25, // 25% hard stop
  };

  it('activates trailing and exits when price trails back', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // Entry
      { open: 1.0, high: 1.3, low: 1.0, close: 1.2 }, // Activate trailing (20% gain hit at 1.2)
      { open: 1.2, high: 1.5, low: 1.2, close: 1.4 }, // New peak at 1.5
      { open: 1.4, high: 1.4, low: 1.3, close: 1.32 }, // Trail stop at 1.35 (1.5 * 0.9 = 1.35)
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.exitReason).toBe('trailing_stop');
    expect(result.stopOut).toBe(true);
  });

  it('triggers hard stop before trailing activates', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // Entry
      { open: 1.0, high: 1.1, low: 0.7, close: 0.8 }, // Hard stop hit at 0.75 (25% loss)
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.exitReason).toBe('hard_stop');
    expect(result.stopOut).toBe(true);
  });

  it('does not activate trailing below threshold', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 1.15, low: 0.9, close: 1.1 }, // Only 15% gain, not 20%
      { open: 1.1, high: 1.1, low: 0.9, close: 0.95 }, // Price drops
    ]);

    const result = executePolicy(candles, startTs, policy);

    // Trailing not activated, so should exit at end or hard stop
    expect(result.exitReason).toBe('end_of_data');
    expect(result.stopOut).toBe(false);
  });
});

// =============================================================================
// Ladder Policy Tests
// =============================================================================

describe('executePolicy - Ladder', () => {
  const policy: LadderPolicy = {
    kind: 'ladder',
    levels: [
      { multiple: 2.0, fraction: 0.5 },
      { multiple: 3.0, fraction: 0.3 },
      { multiple: 4.0, fraction: 0.2 },
    ],
    stopPct: 0.2,
  };

  it('executes ladder exits at multiple levels', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 2.5, low: 1.0, close: 2.2 }, // Hit 2x
      { open: 2.2, high: 3.5, low: 2.0, close: 3.2 }, // Hit 3x
      { open: 3.2, high: 4.5, low: 3.0, close: 4.0 }, // Hit 4x
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.exitReason).toBe('ladder_complete');
    expect(result.realizedReturnBps).toBeGreaterThan(0);
  });

  it('stops out remaining position when stop is hit', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 2.2, low: 1.0, close: 2.0 }, // Hit 2x (exit 50%)
      { open: 2.0, high: 2.0, low: 0.7, close: 0.8 }, // Stop hit for remaining 50%
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.stopOut).toBe(true);
    // Partial profit from 2x + loss from stop
  });

  it('handles partial ladder completion', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 2.5, low: 1.0, close: 2.2 }, // Hit 2x only
      { open: 2.2, high: 2.8, low: 2.0, close: 2.5 }, // No 3x or 4x
    ]);

    const result = executePolicy(candles, startTs, policy);

    expect(result.exitReason).toBe('end_of_data');
    expect(result.realizedReturnBps).toBeGreaterThan(0); // Partial gain from 2x level
  });

  // INVARIANT: realized return <= peak for ladder
  it('invariant: realized return <= peak return for ladder', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 5.0, low: 1.0, close: 4.5 },
    ]);

    const result = executePolicy(candles, startTs, policy);

    const peakReturnBps = (5.0 / 1.0 - 1) * 10000;
    expect(result.realizedReturnBps).toBeLessThanOrEqual(peakReturnBps);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe('executePolicy - Edge Cases', () => {
  it('handles empty candle array', () => {
    const result = executePolicy([], 1704067200000, {
      kind: 'fixed_stop',
      stopPct: 0.2,
    });

    expect(result.exitReason).toBe('no_entry');
    expect(result.realizedReturnBps).toBe(0);
  });

  it('handles candles all before alert time', () => {
    const alertTs = 1704067200000;
    const candles = createCandles(alertTs - 120000, [
      // All before alert
      { open: 1.0, high: 1.1, low: 0.9, close: 1.0 },
    ]);

    const result = executePolicy(candles, alertTs, {
      kind: 'fixed_stop',
      stopPct: 0.2,
    });

    expect(result.exitReason).toBe('no_entry');
  });

  it('handles single candle', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [{ open: 1.0, high: 1.1, low: 0.9, close: 1.05 }]);

    const result = executePolicy(candles, startTs, {
      kind: 'fixed_stop',
      stopPct: 0.2,
    });

    expect(result.exitReason).toBe('end_of_data');
    expect(result.entryPx).toBe(1.05);
    expect(result.exitPx).toBe(1.05);
  });

  it('applies fees correctly', () => {
    const startTs = 1704067200000;
    const candles = createCandles(startTs, [
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 },
      { open: 1.0, high: 1.0, low: 1.0, close: 1.0 }, // No price change
    ]);

    const fees = { takerFeeBps: 30, slippageBps: 10 };
    const result = executePolicy(candles, startTs, { kind: 'fixed_stop', stopPct: 0.2 }, fees);

    // With no price change, gross return is 0
    // Net return should be negative due to fees
    expect(result.realizedReturnBps).toBeLessThan(0);
    expect(result.realizedReturnBps).toBe(-80); // 2 * (30 + 10) = 80 bps in fees
  });
});

// =============================================================================
// Property-Based Tests (Invariants)
// =============================================================================

describe('Policy Execution Invariants', () => {
  const policies = [
    { kind: 'fixed_stop', stopPct: 0.1, takeProfitPct: 0.5 } as const,
    { kind: 'time_stop', maxHoldMs: 300000 } as const,
    { kind: 'trailing_stop', activationPct: 0.1, trailPct: 0.05 } as const,
    { kind: 'ladder', levels: [{ multiple: 1.5, fraction: 1.0 }] } as const,
  ];

  for (const policy of policies) {
    describe(`${policy.kind}`, () => {
      it('invariant: timeExposedMs >= 0', () => {
        const startTs = 1704067200000;
        const candles = createCandles(startTs, [
          { open: 1.0, high: 1.2, low: 0.8, close: 1.1 },
          { open: 1.1, high: 1.5, low: 0.9, close: 1.3 },
        ]);

        const result = executePolicy(candles, startTs, policy);
        expect(result.timeExposedMs).toBeGreaterThanOrEqual(0);
      });

      it('invariant: maxAdverseExcursionBps <= 0', () => {
        const startTs = 1704067200000;
        const candles = createCandles(startTs, [
          { open: 1.0, high: 1.2, low: 0.8, close: 1.1 },
          { open: 1.1, high: 1.5, low: 0.7, close: 1.3 },
        ]);

        const result = executePolicy(candles, startTs, policy);
        expect(result.maxAdverseExcursionBps).toBeLessThanOrEqual(0);
      });

      it('invariant: exitTsMs >= entryTsMs', () => {
        const startTs = 1704067200000;
        const candles = createCandles(startTs, [
          { open: 1.0, high: 1.2, low: 0.8, close: 1.1 },
          { open: 1.1, high: 1.5, low: 0.9, close: 1.3 },
        ]);

        const result = executePolicy(candles, startTs, policy);
        if (result.exitReason !== 'no_entry') {
          expect(result.exitTsMs).toBeGreaterThanOrEqual(result.entryTsMs);
        }
      });
    });
  }
});
