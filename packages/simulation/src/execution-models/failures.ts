/**
 * Failure Models
 * ==============
 *
 * Models for simulating transaction failures, partial fills, and chain reorganizations.
 */

import type { FailureModel, PartialFillModel, ReorgModel } from './types.js';

/**
 * Sample whether a transaction fails based on failure model
 */
export function sampleFailure(
  model: FailureModel,
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

  return Math.random() < failureRate;
}

/**
 * Sample partial fill percentage
 */
export function samplePartialFill(model: PartialFillModel): number {
  if (Math.random() >= model.probability) {
    return 1.0; // Full fill
  }

  if (!model.fillDistribution) {
    return 0.5; // Default 50% if no distribution specified
  }

  const { type, minFill, maxFill, meanFill, stddevFill, alpha, beta } = model.fillDistribution;

  switch (type) {
    case 'uniform':
      return minFill + Math.random() * (maxFill - minFill);

    case 'normal':
      if (meanFill !== undefined && stddevFill !== undefined) {
        // Box-Muller transform
        const u1 = Math.random();
        const u2 = Math.random();
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
        const u1 = Math.random();
        const u2 = Math.random();
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
 */
export function sampleReorg(model: ReorgModel): { affected: boolean; depth: number } {
  if (Math.random() >= model.probability) {
    return { affected: false, depth: 0 };
  }

  // Sample reorg depth (exponential distribution capped at maxDepth)
  const lambda = 1 / model.averageDepth;
  let depth = 1;
  while (depth < model.maxDepth && Math.random() > Math.exp(-lambda)) {
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
