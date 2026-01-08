/**
 * Failure Models
 * ==============
 *
 * Models for simulating transaction failures, partial fills, and chain reorganizations.
 * All randomness uses DeterministicRNG for reproducibility.
 */

import type { DeterministicRNG } from '@quantbot/core';
import type { FailureModel, PartialFillModel, ReorgModel } from './types.js';

/**
 * Sample whether a transaction fails based on failure model
 *
 * @param model - Failure model configuration
 * @param rng - Deterministic random number generator (required for determinism)
 * @param congestionLevel - Current congestion level (0-1)
 * @param priorityFeeShortfall - Priority fee shortfall (0-1)
 */
export function sampleFailure(
  model: FailureModel,
  rng: DeterministicRNG,
  congestionLevel: number = 0,
  priorityFeeShortfall: number = 0
): boolean {
  let failureRate = model.baseFailureRate;

  // Add congestion-based failure rate
  failureRate += model.congestionFailureRate * Math.min(1, congestionLevel);

  // Add fee shortfall-based failure rate
  failureRate += model.feeShortfallFailureRate * Math.min(1, priorityFeeShortfall);

  // Cap at maximum
  failureRate = Math.min(failureRate, model.maxFailureRate);

  return rng.next() < failureRate;
}

/**
 * Sample partial fill percentage
 *
 * @param model - Partial fill model configuration
 * @param rng - Deterministic random number generator (required for determinism)
 */
export function samplePartialFill(model: PartialFillModel, rng: DeterministicRNG): number {
  if (rng.next() >= model.probability) {
    return 1.0; // Full fill
  }

  if (!model.fillDistribution) {
    return 0.5; // Default 50% if no distribution specified
  }

  const { type, minFill, maxFill, meanFill, stddevFill, alpha, beta } = model.fillDistribution;

  switch (type) {
    case 'uniform':
      return minFill + rng.next() * (maxFill - minFill);

    case 'normal':
      if (meanFill !== undefined && stddevFill !== undefined) {
        // Box-Muller transform
        const u1 = rng.next();
        const u2 = rng.next();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const fill = meanFill + z0 * stddevFill;
        return Math.max(0, Math.min(1, fill)); // Clamp to [0, 1]
      }
      return 0.5;

    case 'beta':
      if (alpha !== undefined && beta !== undefined) {
        // Simplified beta distribution using normal approximation
        // For exact beta, would need gamma function
        const mean = alpha / (alpha + beta);
        const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
        const stddev = Math.sqrt(variance);
        const u1 = rng.next();
        const u2 = rng.next();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const fill = mean + z0 * stddev;
        return Math.max(0, Math.min(1, fill));
      }
      return 0.5;

    default:
      return 0.5;
  }
}

/**
 * Sample whether a reorg affects the transaction
 *
 * @param model - Reorg model configuration
 * @param rng - Deterministic random number generator (required for determinism)
 */
export function sampleReorg(
  model: ReorgModel,
  rng: DeterministicRNG
): { affected: boolean; depth: number } {
  if (rng.next() >= model.probability) {
    return { affected: false, depth: 0 };
  }

  // Sample reorg depth (exponential distribution capped at maxDepth)
  const lambda = 1 / model.averageDepth;
  let depth = 1;
  while (depth < model.maxDepth && rng.next() > Math.exp(-lambda)) {
    depth++;
  }

  return { affected: true, depth: Math.min(depth, model.maxDepth) };
}

/**
 * Create default failure model for Pump.fun
 * Higher failure rate due to congestion and competition
 */
export function createPumpfunFailureModel(): FailureModel {
  return {
    baseFailureRate: 0.02, // 2% base failure rate
    congestionFailureRate: 0.05, // +5% per unit of congestion
    feeShortfallFailureRate: 0.1, // +10% per unit of fee shortfall
    maxFailureRate: 0.3, // Cap at 30%
  };
}

/**
 * Create default partial fill model for Pump.fun
 */
export function createPumpfunPartialFillModel(): PartialFillModel {
  return {
    probability: 0.05, // 5% chance of partial fill
    fillDistribution: {
      type: 'uniform',
      minFill: 0.5,
      maxFill: 0.95,
    },
  };
}

/**
 * Create default reorg model for Solana
 * Solana has very low reorg probability
 */
export function createSolanaReorgModel(): ReorgModel {
  return {
    probability: 0.001, // 0.1% chance
    averageDepth: 1,
    maxDepth: 2,
  };
}
