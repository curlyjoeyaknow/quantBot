/**
 * Enhanced Cost Models
 * ====================
 *
 * Enhanced cost calculations including priority fees, compute units, and effective costs.
 */

import type { CostModel } from './types.js';

/**
 * Calculate priority fee for a transaction
 */
export function calculatePriorityFee(model: CostModel, congestionLevel: number = 0): number {
  if (!model.priorityFee) {
    return 0;
  }

  const { baseMicroLamportsPerCu, congestionMultiplier, maxMicroLamportsPerCu } = model.priorityFee;

  // Validate inputs to prevent NaN
  if (
    !Number.isFinite(congestionLevel) ||
    !Number.isFinite(baseMicroLamportsPerCu) ||
    !Number.isFinite(congestionMultiplier) ||
    !Number.isFinite(maxMicroLamportsPerCu)
  ) {
    return 0;
  }

  // Ensure non-negative congestion level
  const safeCongestionLevel = Math.max(0, congestionLevel);
  const multiplier = 1 + (congestionMultiplier - 1) * Math.min(1, safeCongestionLevel);
  const fee = baseMicroLamportsPerCu * multiplier;

  // Ensure result is finite and bounded
  if (!Number.isFinite(fee) || fee < 0) {
    return 0;
  }

  return Math.min(fee, maxMicroLamportsPerCu || 1_000_000);
}

/**
 * Calculate compute unit cost
 */
export function calculateComputeUnitCost(model: CostModel): number {
  if (!model.computeUnits) {
    return 0;
  }

  const { averageCu, cuPriceLamports } = model.computeUnits;
  return averageCu * cuPriceLamports;
}

/**
 * Calculate total transaction cost (fees + priority + compute)
 */
export function calculateTotalTransactionCost(
  model: CostModel,
  tradeAmount: number,
  isEntry: boolean,
  congestionLevel: number = 0
): number {
  // Validate inputs to prevent NaN
  if (!Number.isFinite(tradeAmount) || tradeAmount < 0 || !Number.isFinite(congestionLevel)) {
    return 0;
  }

  // Base trading fee
  const feeBps = isEntry ? model.takerFeeBps : model.takerFeeBps;
  if (!Number.isFinite(feeBps) || feeBps < 0) {
    return 0;
  }

  const tradingFee = (tradeAmount * feeBps) / 10_000;

  // Priority fee (if applicable)
  const priorityFee = calculatePriorityFee(model, congestionLevel);
  const cuCost = calculateComputeUnitCost(model);

  // Convert priority fee from micro-lamports to lamports (if needed)
  // Assuming 1 SOL = 1_000_000_000 lamports, and we're working in SOL units
  const priorityFeeLamports = priorityFee / 1_000_000; // Convert to lamports, then to SOL if needed

  const total = tradingFee + priorityFeeLamports + cuCost;

  // Ensure result is finite and non-negative
  if (!Number.isFinite(total) || total < 0) {
    return 0;
  }

  return total;
}

/**
 * Calculate effective cost per trade (including all fees and slippage)
 */
export function calculateEffectiveCostPerTrade(
  model: CostModel,
  tradeAmount: number,
  slippageBps: number,
  isEntry: boolean,
  congestionLevel: number = 0
): number {
  // Validate inputs to prevent NaN
  if (
    !Number.isFinite(tradeAmount) ||
    tradeAmount < 0 ||
    !Number.isFinite(slippageBps) ||
    slippageBps < 0 ||
    !Number.isFinite(congestionLevel)
  ) {
    return 0;
  }

  const slippageCost = (tradeAmount * slippageBps) / 10_000;
  const transactionCost = calculateTotalTransactionCost(
    model,
    tradeAmount,
    isEntry,
    congestionLevel
  );

  const total = slippageCost + transactionCost;

  // Ensure result is finite and non-negative
  if (!Number.isFinite(total) || total < 0) {
    return 0;
  }

  return total;
}

/**
 * Create default cost model for Pump.fun
 */
export function createPumpfunCostModel(): CostModel {
  return {
    takerFeeBps: 25, // 0.25%
    makerFeeBps: 0,
    priorityFee: {
      baseMicroLamportsPerCu: 21_000, // Typical base priority fee
      congestionMultiplier: 5, // 5x during congestion
      maxMicroLamportsPerCu: 1_000_000, // 1M max
    },
    computeUnits: {
      averageCu: 200_000,
      cuPriceLamports: 0, // Typically included in priority fee
    },
    borrowAprBps: 0,
  };
}

/**
 * Create default cost model for PumpSwap
 */
export function createPumpswapCostModel(): CostModel {
  return {
    takerFeeBps: 30, // Slightly higher fee
    makerFeeBps: 0,
    priorityFee: {
      baseMicroLamportsPerCu: 25_000,
      congestionMultiplier: 4,
      maxMicroLamportsPerCu: 1_000_000,
    },
    computeUnits: {
      averageCu: 200_000,
      cuPriceLamports: 0,
    },
    borrowAprBps: 0,
  };
}
