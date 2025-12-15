/**
 * Fee and Slippage Calculations
 * =============================
 * Calculate trading costs for simulations.
 */

import type { CostConfig } from '../types';

/**
 * Default cost configuration
 */
export const DEFAULT_COST_CONFIG: CostConfig = {
  entrySlippageBps: 0,
  exitSlippageBps: 0,
  takerFeeBps: 25, // 0.25% typical DEX fee
  borrowAprBps: 0,
};

/**
 * Calculate entry price after costs (price you actually pay)
 */
export function calculateEntryPriceWithCosts(price: number, config: CostConfig): number {
  // Handle invalid inputs
  if (price <= 0 || !Number.isFinite(price)) {
    return 0;
  }

  const slippageMultiplier = 1 + config.entrySlippageBps / 10_000;
  const feeMultiplier = 1 + config.takerFeeBps / 10_000;
  const result = price * slippageMultiplier * feeMultiplier;

  // Ensure result is valid
  return Number.isFinite(result) ? result : price;
}

/**
 * Calculate exit price after costs (price you actually receive)
 */
export function calculateExitPriceWithCosts(price: number, config: CostConfig): number {
  // Handle invalid inputs
  if (price <= 0 || !Number.isFinite(price)) {
    return 0;
  }

  const slippageMultiplier = 1 - config.exitSlippageBps / 10_000;
  const feeMultiplier = 1 - config.takerFeeBps / 10_000;
  const result = price * slippageMultiplier * feeMultiplier;

  // Ensure result is valid and non-negative
  if (!Number.isFinite(result) || result < 0) {
    return 0;
  }

  return result;
}

/**
 * Calculate entry cost multiplier (>1)
 */
export function getEntryCostMultiplier(config: CostConfig): number {
  return 1 + (config.entrySlippageBps + config.takerFeeBps) / 10_000;
}

/**
 * Calculate exit cost multiplier (<1)
 */
export function getExitCostMultiplier(config: CostConfig): number {
  return Math.max(0, 1 - (config.exitSlippageBps + config.takerFeeBps) / 10_000);
}

/**
 * Calculate total fee for a trade
 */
export function calculateTradeFee(amount: number, isEntry: boolean, config: CostConfig): number {
  // Handle invalid inputs
  if (amount <= 0 || !Number.isFinite(amount)) {
    return 0;
  }

  const slippageBps = isEntry ? config.entrySlippageBps : config.exitSlippageBps;
  const totalBps = slippageBps + config.takerFeeBps;
  const fee = (amount * totalBps) / 10_000;

  // Ensure fee doesn't exceed amount and is valid
  if (!Number.isFinite(fee) || fee < 0) {
    return 0;
  }

  return Math.min(fee, amount);
}

/**
 * Calculate borrow cost for holding a short position
 */
export function calculateBorrowCost(
  amount: number,
  holdDurationSeconds: number,
  config: CostConfig
): number {
  if (config.borrowAprBps === 0) return 0;

  const annualRate = config.borrowAprBps / 10_000;
  const secondsPerYear = 365.25 * 24 * 60 * 60;
  const holdFraction = holdDurationSeconds / secondsPerYear;

  return amount * annualRate * holdFraction;
}

/**
 * Calculate PnL considering all costs
 */
export function calculateNetPnl(
  entryPrice: number,
  exitPrice: number,
  size: number,
  holdDurationSeconds: number,
  config: CostConfig,
  isLong: boolean = true
): number {
  // Handle edge cases: zero or negative prices
  if (entryPrice <= 0 || exitPrice <= 0 || size <= 0) {
    return 0;
  }

  const effectiveEntry = calculateEntryPriceWithCosts(entryPrice, config);
  const effectiveExit = calculateExitPriceWithCosts(exitPrice, config);

  // Handle invalid calculations
  if (!Number.isFinite(effectiveEntry) || !Number.isFinite(effectiveExit)) {
    return 0;
  }

  const grossPnl = isLong
    ? (effectiveExit - effectiveEntry) * size
    : (effectiveEntry - effectiveExit) * size;

  const borrowCost = isLong
    ? 0
    : calculateBorrowCost(entryPrice * size, holdDurationSeconds, config);

  return grossPnl - borrowCost;
}

/**
 * Calculate PnL as a multiplier (1 = break even)
 */
export function calculatePnlMultiplier(
  entryPrice: number,
  exitPrice: number,
  config: CostConfig,
  isLong: boolean = true
): number {
  // Handle edge cases: zero or negative prices
  if (entryPrice <= 0 || exitPrice <= 0) {
    return 0;
  }

  const effectiveEntry = calculateEntryPriceWithCosts(entryPrice, config);
  const effectiveExit = calculateExitPriceWithCosts(exitPrice, config);

  // Handle division by zero or very small numbers
  if (effectiveEntry <= 0 || !Number.isFinite(effectiveEntry) || !Number.isFinite(effectiveExit)) {
    return 0;
  }

  if (isLong) {
    return effectiveExit / effectiveEntry;
  } else {
    return (2 * effectiveEntry - effectiveExit) / effectiveEntry;
  }
}
