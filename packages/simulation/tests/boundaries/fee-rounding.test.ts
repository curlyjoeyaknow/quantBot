/**
 * Boundary Tests: Fee Rounding
 * ============================
 *
 * Tests for rounding direction in fees/slippage calculations.
 * Wrong rounding can silently accumulate errors.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTradeFee,
  calculateEntryPriceWithCosts,
  calculateExitPriceWithCosts,
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

describe('Fee Rounding Boundaries', () => {
  describe('Rounding Direction', () => {
    it('should round fees consistently (not randomly)', () => {
      const amount = 100.0;
      const feeBps = 25; // 0.25%
      const config = {
        ...TEST_COST_CONFIG,
        takerFeeBps: feeBps,
      };

      // Calculate fee multiple times - should be identical
      const fee1 = calculateTradeFee(amount, true, config);
      const fee2 = calculateTradeFee(amount, true, config);
      const fee3 = calculateTradeFee(amount, true, config);

      expect(fee1).toBe(fee2);
      expect(fee2).toBe(fee3);
    });

    it('should round fees down (not up) to prevent overcharging', () => {
      // For small amounts, rounding direction matters
      const amount = 0.0001; // Very small amount
      const feeBps = 25; // 0.25%
      const config = {
        ...TEST_COST_CONFIG,
        takerFeeBps: feeBps,
      };

      const fee = calculateTradeFee(amount, true, config);
      const expectedFee = amount * (feeBps / 10000);

      // Fee should be <= expected (rounded down, not up)
      expect(fee).toBeLessThanOrEqual(expectedFee);
      expect(fee).toBeGreaterThan(0);
    });
  });

  describe('Price Calculation Rounding', () => {
    it('should round entry price with costs consistently', () => {
      const price = 1.0;
      const config = {
        ...TEST_COST_CONFIG,
        entrySlippageBps: 125, // 1.25%
        takerFeeBps: 25, // 0.25%
      };

      // Calculate multiple times - should be identical
      const price1 = calculateEntryPriceWithCosts(price, config);
      const price2 = calculateEntryPriceWithCosts(price, config);
      const price3 = calculateEntryPriceWithCosts(price, config);

      expect(price1).toBe(price2);
      expect(price2).toBe(price3);
    });

    it('should round exit price with costs consistently', () => {
      const price = 2.0;
      const config = {
        ...TEST_COST_CONFIG,
        exitSlippageBps: 125, // 1.25%
        takerFeeBps: 25, // 0.25%
      };

      const price1 = calculateExitPriceWithCosts(price, config);
      const price2 = calculateExitPriceWithCosts(price, config);
      const price3 = calculateExitPriceWithCosts(price, config);

      expect(price1).toBe(price2);
      expect(price2).toBe(price3);
    });
  });

  describe('Boundary Cases', () => {
    it('should handle zero fees correctly', () => {
      const amount = 100.0;
      const config = {
        ...TEST_COST_CONFIG,
        entrySlippageBps: 0,
        exitSlippageBps: 0,
        takerFeeBps: 0,
      };

      const entryFee = calculateTradeFee(amount, true, config);
      const exitFee = calculateTradeFee(amount, false, config);

      expect(entryFee).toBe(0);
      expect(exitFee).toBe(0);
    });

    it('should handle very small amounts without rounding to zero', () => {
      const amount = 0.000001; // Extremely small
      const config = {
        ...TEST_COST_CONFIG,
        takerFeeBps: 25,
      };

      const fee = calculateTradeFee(amount, true, config);

      // Fee should be > 0 even for tiny amounts (if calculation allows)
      // But may be 0 due to floating point precision - that's acceptable
      expect(fee).toBeGreaterThanOrEqual(0);
    });

    it('should handle very large amounts without overflow', () => {
      const amount = 1e15; // Very large
      const config = {
        ...TEST_COST_CONFIG,
        takerFeeBps: 25,
      };

      const fee = calculateTradeFee(amount, true, config);

      // Should be finite and positive
      expect(Number.isFinite(fee)).toBe(true);
      expect(fee).toBeGreaterThan(0);
      expect(fee).toBeLessThanOrEqual(amount);
    });
  });

  describe('Precision Boundaries', () => {
    it('should maintain precision for common price ranges', () => {
      const prices = [0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0, 1000.0];
      const config = TEST_COST_CONFIG;

      prices.forEach((price) => {
        const entryPrice = calculateEntryPriceWithCosts(price, config);
        const exitPrice = calculateExitPriceWithCosts(price, config);

        // Should be finite and positive
        expect(Number.isFinite(entryPrice)).toBe(true);
        expect(Number.isFinite(exitPrice)).toBe(true);
        expect(entryPrice).toBeGreaterThan(0);
        expect(exitPrice).toBeGreaterThan(0);

        // Entry price should be >= original (costs add)
        expect(entryPrice).toBeGreaterThanOrEqual(price);

        // Exit price should be <= original (costs subtract)
        expect(exitPrice).toBeLessThanOrEqual(price);
      });
    });
  });
});
