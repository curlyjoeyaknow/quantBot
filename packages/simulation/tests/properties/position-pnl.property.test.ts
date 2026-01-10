/**
 * Property Tests for Position PnL Calculations
 * ============================================
 *
 * Tests critical invariants for position PnL calculations.
 *
 * Critical Invariants:
 * 1. Unrealized PnL is finite for all valid inputs
 * 2. Total PnL = realized + unrealized (conservation law)
 * 3. PnL percent is bounded and finite
 * 4. Long positions: higher price = higher PnL (monotonicity)
 * 5. Short positions: higher price = lower PnL (monotonicity)
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateUnrealizedPnl,
  calculateTotalPnl,
  calculatePnlPercent,
} from '../../src/position/position.js';
import type { Position } from '../../src/types/position.js';

function createPosition(overrides: Partial<Position> = {}): Position {
  return {
    id: '1',
    tokenAddress: 'So11111111111111111111111111111111111111112',
    chain: 'solana',
    side: 'long',
    status: 'pending',
    openTimestamp: 0,
    averageEntryPrice: 0,
    size: 0,
    maxSize: 0,
    initialSize: 1,
    peakPrice: 0,
    lowestPrice: Infinity,
    realizedPnl: 0,
    unrealizedPnl: 0,
    totalFees: 0,
    executions: [],
    ladderLegsExecuted: new Set(),
    reEntryCount: 0,
    maxReEntries: 0,
    ...overrides,
  };
}

describe('Position PnL Calculations - Property Tests', () => {
  describe('Unrealized PnL Bounds (Critical Invariant)', () => {
    it('unrealized PnL is always finite for valid inputs', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          (entryPrice, currentPrice, size) => {
            // Filter out invalid inputs that would cause NaN
            if (
              !Number.isFinite(entryPrice) ||
              !Number.isFinite(currentPrice) ||
              !Number.isFinite(size) ||
              entryPrice <= 0 ||
              currentPrice <= 0 ||
              size <= 0
            ) {
              return true; // Skip invalid inputs
            }

            const position = createPosition({
              averageEntryPrice: entryPrice,
              size,
              initialSize: size,
            });

            const pnl = calculateUnrealizedPnl(position, currentPrice);
            return Number.isFinite(pnl);
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('unrealized PnL returns 0 for zero-size positions', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          (entryPrice, currentPrice) => {
            // Filter out invalid inputs
            if (!Number.isFinite(entryPrice) || !Number.isFinite(currentPrice)) {
              return true;
            }

            const position = createPosition({
              averageEntryPrice: entryPrice,
              size: 0,
              initialSize: 0,
            });

            const pnl = calculateUnrealizedPnl(position, currentPrice);
            return pnl === 0;
          }
        ),
        { numRuns: 100, timeout: 10000 }
      );
    });
  });

  describe('Long Position Monotonicity (Critical Invariant)', () => {
    it('higher price produces higher unrealized PnL for long positions', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(10) }),
          (entryPrice, price1, price2, size) => {
            // Ensure price2 > price1
            const lowPrice = Math.min(price1, price2);
            const highPrice = Math.max(price1, price2);
            if (lowPrice === highPrice) return true;

            const position = createPosition({
              side: 'long',
              averageEntryPrice: entryPrice,
              size,
              initialSize: size,
            });

            const pnl1 = calculateUnrealizedPnl(position, lowPrice);
            const pnl2 = calculateUnrealizedPnl(position, highPrice);

            // Both should be finite
            if (!Number.isFinite(pnl1) || !Number.isFinite(pnl2)) {
              return true; // Skip invalid results
            }

            return pnl2 >= pnl1;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('Short Position Monotonicity (Critical Invariant)', () => {
    it('higher price produces lower unrealized PnL for short positions', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(10) }),
          (entryPrice, price1, price2, size) => {
            // Ensure price2 > price1
            const lowPrice = Math.min(price1, price2);
            const highPrice = Math.max(price1, price2);
            if (lowPrice === highPrice) return true;

            const position = createPosition({
              side: 'short',
              averageEntryPrice: entryPrice,
              size,
              initialSize: size,
            });

            const pnl1 = calculateUnrealizedPnl(position, lowPrice);
            const pnl2 = calculateUnrealizedPnl(position, highPrice);

            // Both should be finite
            if (!Number.isFinite(pnl1) || !Number.isFinite(pnl2)) {
              return true; // Skip invalid results
            }

            return pnl2 <= pnl1;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('Total PnL Conservation Law (Critical Invariant)', () => {
    it('total PnL = realized + unrealized (conservation)', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(-1000), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(10) }),
          (entryPrice, currentPrice, realizedPnl, size) => {
            const position = createPosition({
              averageEntryPrice: entryPrice,
              size,
              initialSize: size,
              realizedPnl,
            });

            const unrealized = calculateUnrealizedPnl(position, currentPrice);
            const total = calculateTotalPnl(position, currentPrice);

            // Both should be finite
            if (!Number.isFinite(unrealized) || !Number.isFinite(total)) {
              return true; // Skip invalid results
            }

            // Allow small floating point errors
            const diff = Math.abs(total - (realizedPnl + unrealized));
            return diff < 0.0001;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('PnL Percent Bounds (Critical Invariant)', () => {
    it('PnL percent is always finite', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(-1000), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(10) }),
          (entryPrice, currentPrice, realizedPnl, size) => {
            // Filter out invalid inputs that would cause NaN
            if (
              !Number.isFinite(entryPrice) ||
              !Number.isFinite(currentPrice) ||
              !Number.isFinite(realizedPnl) ||
              !Number.isFinite(size) ||
              entryPrice <= 0 ||
              size <= 0
            ) {
              return true; // Skip invalid inputs
            }

            const position = createPosition({
              averageEntryPrice: entryPrice,
              size,
              initialSize: size,
              realizedPnl,
            });

            const pct = calculatePnlPercent(position, currentPrice);
            return Number.isFinite(pct);
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('PnL percent returns 0 for zero entry price or size', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100) }),
          fc.float({ min: Math.fround(-100), max: Math.fround(100) }),
          (currentPrice, realizedPnl) => {
            // Test zero entry price
            const position1 = createPosition({
              averageEntryPrice: 0,
              size: 1,
              initialSize: 1,
              realizedPnl,
            });
            const pct1 = calculatePnlPercent(position1, currentPrice);

            // Test zero initial size
            const position2 = createPosition({
              averageEntryPrice: 1,
              size: 0,
              initialSize: 0,
              realizedPnl,
            });
            const pct2 = calculatePnlPercent(position2, currentPrice);

            return pct1 === 0 && pct2 === 0;
          }
        ),
        { numRuns: 100, timeout: 10000 }
      );
    });
  });
});
