/**
 * Unit tests for Simulation Invariants
 */

import { describe, it, expect } from 'vitest';
import { checkInvariants, passesInvariants } from '../../src/core/simulation-invariants.js';
import type { SimResult } from '@quantbot/backtest';

describe('Simulation Invariants', () => {
  const validResult: SimResult = {
    run_id: 'test_001',
    final_pnl: 1.5,
    events: [
      {
        event_type: 'entry',
        timestamp: 1704110400,
        price: 1.0,
        quantity: 1.0,
        value_usd: 1.0,
        fee_usd: 0.001,
        position_size: 1.0,
      },
      {
        event_type: 'target_hit',
        timestamp: 1704110520,
        price: 2.0,
        quantity: 1.0,
        value_usd: 2.0,
        fee_usd: 0.002,
        pnl_usd: 0.997,
        cumulative_pnl_usd: 0.997,
        position_size: 1.0,
      },
    ],
    entry_price: 1.0,
    final_price: 2.0,
    total_candles: 3,
    metrics: {
      win_rate: 1.0,
      total_trades: 1,
    },
  };

  it('should pass all invariants for valid result', () => {
    const violations = checkInvariants(validResult);
    expect(violations).toHaveLength(0);
    expect(passesInvariants(validResult)).toBe(true);
  });

  it('should detect negative final PnL', () => {
    const invalidResult: SimResult = {
      ...validResult,
      final_pnl: -0.5,
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.invariant === 'final_pnl_non_negative')).toBe(true);
  });

  it('should detect non-positive entry price', () => {
    const invalidResult: SimResult = {
      ...validResult,
      entry_price: 0,
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'entry_price_positive')).toBe(true);
  });

  it('should detect non-positive final price', () => {
    const invalidResult: SimResult = {
      ...validResult,
      final_price: -1.0,
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'final_price_positive')).toBe(true);
  });

  it('should detect out-of-order events', () => {
    const invalidResult: SimResult = {
      ...validResult,
      events: [
        validResult.events[1], // Later event first
        validResult.events[0], // Earlier event second
      ],
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'events_chronological')).toBe(true);
  });

  it('should detect non-entry first event', () => {
    const invalidResult: SimResult = {
      ...validResult,
      events: [
        {
          event_type: 'exit',
          timestamp: 1704110400,
          price: 1.0,
          quantity: 1.0,
          value_usd: 1.0,
          fee_usd: 0.001,
          position_size: 1.0,
        },
      ],
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'first_event_entry')).toBe(true);
  });

  it('should detect non-positive total candles', () => {
    const invalidResult: SimResult = {
      ...validResult,
      total_candles: 0,
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'total_candles_positive')).toBe(true);
  });

  it('should detect negative event prices', () => {
    const invalidResult: SimResult = {
      ...validResult,
      events: [
        {
          ...validResult.events[0],
          price: -1.0,
        },
      ],
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'event_price_positive')).toBe(true);
  });

  it('should detect negative event quantities', () => {
    const invalidResult: SimResult = {
      ...validResult,
      events: [
        {
          ...validResult.events[0],
          quantity: -1.0,
        },
      ],
    };
    const violations = checkInvariants(invalidResult);
    expect(violations.some((v) => v.invariant === 'event_quantity_non_negative')).toBe(true);
  });
});
