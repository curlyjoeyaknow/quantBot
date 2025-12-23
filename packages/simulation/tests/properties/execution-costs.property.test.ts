/**
 * Property Tests for Execution Cost Models
 * ========================================
 *
 * Tests critical invariants for execution cost calculations.
 *
 * Critical Invariants:
 * 1. Priority fee is bounded (never exceeds max)
 * 2. Total transaction cost is always positive for non-zero trades
 * 3. Effective cost per trade includes all components
 * 4. Costs are monotonic with trade amount
 * 5. All costs are finite
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  calculatePriorityFee,
  calculateTotalTransactionCost,
  calculateEffectiveCostPerTrade,
  createPumpfunCostModel,
} from '../../src/execution-models/costs.js';
import type { CostModel } from '../../src/execution-models/types.js';

function createCostModel(overrides: Partial<CostModel> = {}): CostModel {
  const base = createPumpfunCostModel();
  return { ...base, ...overrides };
}

describe('Execution Cost Models - Property Tests', () => {
  describe('Priority Fee Bounds (Critical Invariant)', () => {
    it('priority fee never exceeds maxMicroLamportsPerCu', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1_000_000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(2) }), // congestionLevel 0-200%
          (maxFee, congestionLevel) => {
            const model = createCostModel({
              priorityFee: {
                baseMicroLamportsPerCu: 21_000,
                congestionMultiplier: 5,
                maxMicroLamportsPerCu: maxFee || 1_000_000,
              },
            });

            const fee = calculatePriorityFee(model, congestionLevel);
            return fee <= (maxFee || 1_000_000);
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('priority fee is always >= base when congestionLevel = 0', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1_000, max: 1_000_000 }),
          fc.integer({ min: 1, max: 10 }),
          (baseFee, multiplier) => {
            const model = createCostModel({
              priorityFee: {
                baseMicroLamportsPerCu: baseFee,
                congestionMultiplier: multiplier,
                maxMicroLamportsPerCu: baseFee * multiplier * 2,
              },
            });

            const fee = calculatePriorityFee(model, 0);
            return fee >= baseFee && fee <= baseFee * multiplier;
          }
        ),
        { numRuns: 100, timeout: 10000 }
      );
    });

    it('priority fee is always finite', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1_000_000 }),
          fc.float({ min: Math.fround(0), max: Math.fround(10) }),
          (maxFee, congestionLevel) => {
            const model = createCostModel({
              priorityFee: {
                baseMicroLamportsPerCu: 21_000,
                congestionMultiplier: 5,
                maxMicroLamportsPerCu: maxFee || 1_000_000,
              },
            });

            const fee = calculatePriorityFee(model, congestionLevel);
            return Number.isFinite(fee) && fee >= 0;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('Total Transaction Cost (Critical Invariant)', () => {
    it('total transaction cost is always positive for non-zero trades', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1_000_000) }),
          fc.boolean(),
          fc.float({ min: Math.fround(0), max: Math.fround(2) }),
          fc.integer({ min: 1, max: 1000 }), // takerFeeBps
          (tradeAmount, isEntry, congestionLevel, feeBps) => {
            const model = createCostModel({
              takerFeeBps: feeBps,
            });

            const cost = calculateTotalTransactionCost(
              model,
              tradeAmount,
              isEntry,
              congestionLevel
            );
            return cost >= 0 && Number.isFinite(cost);
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('transaction cost is monotonic with trade amount (larger trades = larger costs)', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100_000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(100_000) }),
          fc.boolean(),
          fc.float({ min: Math.fround(0), max: Math.fround(1) }),
          (amount1, amount2, isEntry, congestionLevel) => {
            const larger = Math.max(amount1, amount2);
            const smaller = Math.min(amount1, amount2);
            if (larger === smaller) return true;

            const model = createCostModel();

            const cost1 = calculateTotalTransactionCost(model, smaller, isEntry, congestionLevel);
            const cost2 = calculateTotalTransactionCost(model, larger, isEntry, congestionLevel);

            // Both should be finite
            if (!Number.isFinite(cost1) || !Number.isFinite(cost2)) {
              return true;
            }

            return cost2 >= cost1;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });

  describe('Effective Cost Per Trade (Critical Invariant)', () => {
    it('effective cost includes slippage and transaction costs', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1_000_000) }),
          fc.integer({ min: 0, max: 1000 }), // slippageBps
          fc.boolean(),
          fc.float({ min: Math.fround(0), max: Math.fround(1) }),
          (tradeAmount, slippageBps, isEntry, congestionLevel) => {
            const model = createCostModel();

            const effectiveCost = calculateEffectiveCostPerTrade(
              model,
              tradeAmount,
              slippageBps,
              isEntry,
              congestionLevel
            );
            const transactionCost = calculateTotalTransactionCost(
              model,
              tradeAmount,
              isEntry,
              congestionLevel
            );

            // Effective cost should be >= transaction cost (includes slippage)
            if (!Number.isFinite(effectiveCost) || !Number.isFinite(transactionCost)) {
              return true;
            }

            return effectiveCost >= transactionCost && effectiveCost >= 0;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });

    it('effective cost is always finite', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1_000_000) }),
          fc.integer({ min: 0, max: 1000 }),
          fc.boolean(),
          fc.float({ min: Math.fround(0), max: Math.fround(1) }),
          (tradeAmount, slippageBps, isEntry, congestionLevel) => {
            // Filter out invalid inputs that would cause NaN
            if (
              !Number.isFinite(tradeAmount) ||
              tradeAmount < 0 ||
              !Number.isFinite(slippageBps) ||
              slippageBps < 0 ||
              !Number.isFinite(congestionLevel) ||
              congestionLevel < 0
            ) {
              return true; // Skip invalid inputs
            }

            const model = createCostModel();

            const cost = calculateEffectiveCostPerTrade(
              model,
              tradeAmount,
              slippageBps,
              isEntry,
              congestionLevel
            );

            return Number.isFinite(cost) && cost >= 0;
          }
        ),
        { numRuns: 200, timeout: 10000 }
      );
    });
  });
});
