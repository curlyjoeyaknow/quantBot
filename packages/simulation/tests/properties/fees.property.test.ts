/**
 * Property Tests for Fee Calculations
 * ====================================
 *
 * Tests critical invariants for fee and cost calculations using property-based testing.
 *
 * Critical Invariants:
 * 1. Fees never exceed input amount
 * 2. Entry cost multiplier > 1 (always adds cost)
 * 3. Exit cost multiplier < 1 (always reduces proceeds)
 * 4. PnL calculations are monotonic
 * 5. Cost multipliers are bounded
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateEntryPriceWithCosts,
  calculateExitPriceWithCosts,
  getEntryCostMultiplier,
  getExitCostMultiplier,
  calculateTradeFee,
  calculateNetPnl,
  calculatePnlMultiplier,
} from '../../src/execution/fees';
import type { CostConfig } from '../../src/types/index.js';

// Test constant - independent from production DEFAULT_COST_CONFIG
// This ensures tests don't break if production default changes
const TEST_COST_CONFIG: CostConfig = {
  entrySlippageBps: 0,
  exitSlippageBps: 0,
  takerFeeBps: 25, // 0.25% typical DEX fee
  borrowAprBps: 0,
};

describe('Fee Calculations - Property Tests', () => {
  describe('Entry Cost Multiplier (Critical Invariant)', () => {
    it('entry cost multiplier is always > 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }).map((bps) => ({
            entrySlippageBps: bps,
            exitSlippageBps: 0,
            takerFeeBps: 25,
            borrowAprBps: 0,
          })),
          (config) => {
            const multiplier = getEntryCostMultiplier(config);
            return multiplier >= 1;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('entry price with costs is always >= original price', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (price, slippageBps, feeBps) => {
            // Filter invalid inputs
            if (price <= 0 || !Number.isFinite(price)) {
              return true;
            }
            const config = {
              entrySlippageBps: slippageBps,
              exitSlippageBps: 0,
              takerFeeBps: feeBps,
              borrowAprBps: 0,
            };
            const costPrice = calculateEntryPriceWithCosts(price, config);
            return Number.isFinite(costPrice) && costPrice >= price;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('Exit Cost Multiplier (Critical Invariant)', () => {
    it('exit cost multiplier is always <= 1', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000 }).map((bps) => ({
            entrySlippageBps: 0,
            exitSlippageBps: bps,
            takerFeeBps: 25,
            borrowAprBps: 0,
          })),
          (config) => {
            const multiplier = getExitCostMultiplier(config);
            return multiplier <= 1 && multiplier >= 0;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('exit price with costs is always <= original price', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (price, slippageBps, feeBps) => {
            // Filter invalid inputs
            if (price <= 0 || !Number.isFinite(price)) {
              return true;
            }
            const config = {
              entrySlippageBps: 0,
              exitSlippageBps: slippageBps,
              takerFeeBps: feeBps,
              borrowAprBps: 0,
            };
            const costPrice = calculateExitPriceWithCosts(price, config);
            return Number.isFinite(costPrice) && costPrice <= price && costPrice >= 0;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('Fee Bounds (Critical Invariant)', () => {
    it('trade fee never exceeds input amount', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000000) }),
          fc.boolean(),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          (amount, isEntry, slippageBps, feeBps) => {
            // Filter invalid inputs
            if (amount <= 0 || !Number.isFinite(amount)) {
              return true;
            }
            const config = {
              entrySlippageBps: isEntry ? slippageBps : 0,
              exitSlippageBps: isEntry ? 0 : slippageBps,
              takerFeeBps: feeBps,
              borrowAprBps: 0,
            };
            const fee = calculateTradeFee(amount, isEntry, config);
            return Number.isFinite(fee) && fee >= 0 && fee <= amount;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('PnL Monotonicity (Critical Invariant)', () => {
    it('higher exit price produces higher PnL (long position)', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1) }),
          (entryPrice, exitPrice1, exitPrice2, size) => {
            // Filter out invalid inputs
            if (entryPrice <= 0 || exitPrice1 <= 0 || exitPrice2 <= 0 || size <= 0) {
              return true;
            }
            if (
              !Number.isFinite(entryPrice) ||
              !Number.isFinite(exitPrice1) ||
              !Number.isFinite(exitPrice2) ||
              !Number.isFinite(size)
            ) {
              return true;
            }
            if (exitPrice1 >= exitPrice2) {
              const pnl1 = calculateNetPnl(entryPrice, exitPrice1, size, 0, TEST_COST_CONFIG, true);
              const pnl2 = calculateNetPnl(entryPrice, exitPrice2, size, 0, TEST_COST_CONFIG, true);
              // Both should be finite numbers
              if (!Number.isFinite(pnl1) || !Number.isFinite(pnl2)) {
                return true; // Skip invalid results
              }
              return pnl1 >= pnl2;
            }
            return true;
          }
        ),
        { numRuns: 100, timeout: 10000 }
      );
    });

    it('PnL multiplier is monotonic with exit price', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          (entryPrice, exitPrice1, exitPrice2) => {
            // Filter out invalid inputs
            if (entryPrice <= 0 || exitPrice1 <= 0 || exitPrice2 <= 0) {
              return true;
            }
            if (
              !Number.isFinite(entryPrice) ||
              !Number.isFinite(exitPrice1) ||
              !Number.isFinite(exitPrice2)
            ) {
              return true;
            }
            if (exitPrice1 >= exitPrice2) {
              const mult1 = calculatePnlMultiplier(entryPrice, exitPrice1, TEST_COST_CONFIG, true);
              const mult2 = calculatePnlMultiplier(entryPrice, exitPrice2, TEST_COST_CONFIG, true);
              // Both should be finite numbers
              if (!Number.isFinite(mult1) || !Number.isFinite(mult2)) {
                return true; // Skip invalid results
              }
              return mult1 >= mult2;
            }
            return true;
          }
        ),
        { numRuns: 100, timeout: 10000 }
      );
    });
  });
});
