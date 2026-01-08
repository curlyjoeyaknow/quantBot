/**
 * Simulation Invariants
 *
 * Properties that must always hold for valid simulation results.
 * These invariants are checked to ensure simulation correctness.
 */

import type { SimResult } from '@quantbot/backtest';

/**
 * Invariant violation
 */
export interface InvariantViolation {
  /** Invariant name */
  invariant: string;
  /** Violation description */
  violation: string;
  /** Result that violated the invariant */
  result: SimResult;
}

/**
 * Check all invariants on a simulation result
 *
 * @param result - Simulation result to check
 * @returns Array of violations (empty if all invariants pass)
 */
export function checkInvariants(result: SimResult): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // Invariant 1: Final PnL must be >= 0 (can't lose more than invested)
  // Note: Actually, final_pnl is a multiplier, so it can be < 1.0 but not < 0
  if (result.final_pnl < 0) {
    violations.push({
      invariant: 'final_pnl_non_negative',
      violation: `Final PnL is negative: ${result.final_pnl}`,
      result,
    });
  }

  // Invariant 2: Entry price must be > 0
  if (result.entry_price <= 0) {
    violations.push({
      invariant: 'entry_price_positive',
      violation: `Entry price is not positive: ${result.entry_price}`,
      result,
    });
  }

  // Invariant 3: Final price must be > 0
  if (result.final_price <= 0) {
    violations.push({
      invariant: 'final_price_positive',
      violation: `Final price is not positive: ${result.final_price}`,
      result,
    });
  }

  // Invariant 4: Events must be in chronological order
  for (let i = 1; i < result.events.length; i++) {
    if (result.events[i].timestamp < result.events[i - 1].timestamp) {
      violations.push({
        invariant: 'events_chronological',
        violation: `Event ${i} timestamp (${result.events[i].timestamp}) < previous (${result.events[i - 1].timestamp})`,
        result,
      });
    }
  }

  // Invariant 5: First event must be entry
  if (result.events.length > 0 && result.events[0].event_type !== 'entry') {
    violations.push({
      invariant: 'first_event_entry',
      violation: `First event is not entry: ${result.events[0].event_type}`,
      result,
    });
  }

  // Invariant 6: Cumulative PnL must be monotonic (for exit events)
  let lastCumulativePnl = 0;
  for (const event of result.events) {
    if (
      (event.event_type === 'exit' ||
        event.event_type === 'target_hit' ||
        event.event_type === 'stop_loss' ||
        event.event_type === 'final_exit') &&
      event.cumulative_pnl_usd !== undefined
    ) {
      if (event.cumulative_pnl_usd < lastCumulativePnl) {
        violations.push({
          invariant: 'cumulative_pnl_monotonic',
          violation: `Cumulative PnL decreased: ${event.cumulative_pnl_usd} < ${lastCumulativePnl}`,
          result,
        });
      }
      lastCumulativePnl = event.cumulative_pnl_usd;
    }
  }

  // Invariant 7: Total candles must match input
  if (result.total_candles <= 0) {
    violations.push({
      invariant: 'total_candles_positive',
      violation: `Total candles is not positive: ${result.total_candles}`,
      result,
    });
  }

  // Invariant 8: All prices must be positive
  for (const event of result.events) {
    if (event.price <= 0) {
      violations.push({
        invariant: 'event_price_positive',
        violation: `Event ${event.event_type} has non-positive price: ${event.price}`,
        result,
      });
    }
  }

  // Invariant 9: Quantity must be non-negative
  for (const event of result.events) {
    if (event.quantity < 0) {
      violations.push({
        invariant: 'event_quantity_non_negative',
        violation: `Event ${event.event_type} has negative quantity: ${event.quantity}`,
        result,
      });
    }
  }

  // Invariant 10: Value USD should be approximately price * quantity (within rounding)
  for (const event of result.events) {
    const expectedValue = event.price * event.quantity;
    const diff = Math.abs(event.value_usd - expectedValue);
    const tolerance = expectedValue * 0.01; // 1% tolerance for fees/slippage
    if (diff > tolerance && expectedValue > 0) {
      violations.push({
        invariant: 'event_value_consistent',
        violation: `Event ${event.event_type} value_usd (${event.value_usd}) differs from price*quantity (${expectedValue}) by ${diff}`,
        result,
      });
    }
  }

  return violations;
}

/**
 * Check if a result passes all invariants
 *
 * @param result - Simulation result to check
 * @returns True if all invariants pass
 */
export function passesInvariants(result: SimResult): boolean {
  return checkInvariants(result).length === 0;
}
