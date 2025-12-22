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
export function calculatePriorityFee(
  model: CostModel,
  congestionLevel: number = 0
): number {
  if (!model.priorityFee) {
    return 0;
  }

  const { baseMicroLamportsPerCu, congestionMultiplier, maxMicroLamportsPerCu } = model.priorityFee;

  const multiplier = 1 + (congestionMultiplier - 1) * Math.min(1, congestionLevel);
  const fee = baseMicroLamportsPerCu * multiplier;

  return Math.min(fee, maxMicroLamportsPerCu);
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
  // Base trading fee
  const feeBps = isEntry ? model.takerFeeBps : model.takerFeeBps;
  const tradingFee = (tradeAmount * feeBps) / 10_000;

  // Priority fee (if applicable)
  const priorityFee = calculatePriorityFee(model, congestionLevel);
  const cuCost = calculateComputeUnitCost(model);

  // Convert priority fee from micro-lamports to lamports (if needed)
  // Assuming 1 SOL = 1_000_000_000 lamports, and we're working in SOL units
  const priorityFeeLamports = priorityFee / 1_000_000; // Convert to lamports, then to SOL if needed

  return tradingFee + priorityFeeLamports + cuCost;
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
  const slippageCost = (tradeAmount * slippageBps) / 10_000;
  const transactionCost = calculateTotalTransactionCost(model, tradeAmount, isEntry, congestionLevel);
  return slippageCost + transactionCost;
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

