/**
 * Slippage Models
 * ===============
 *
 * Models for calculating slippage based on trade size, volume, and market conditions.
 */

import type { SlippageModel, VenueSlippageConfig } from './types.js';

/**
 * Calculate slippage in basis points for a trade
 */
export function calculateSlippage(
  model: SlippageModel,
  tradeSize: number,
  marketVolume24h: number = 0,
  volatilityMultiplier: number = 1
): number {
  let slippageBps: number;

  switch (model.type) {
    case 'fixed':
      slippageBps = model.fixedBps;
      break;

    case 'linear':
      slippageBps = model.linearCoefficient * tradeSize;
      break;

    case 'sqrt':
      slippageBps = model.sqrtCoefficient * Math.sqrt(tradeSize);
      break;

    case 'volume-based':
      // Impact = (tradeSize / marketVolume24h) * volumeImpactBps
      const volumeRatio = marketVolume24h > 0 ? tradeSize / marketVolume24h : 0;
      slippageBps = volumeRatio * model.volumeImpactBps;
      break;

    default:
      slippageBps = model.fixedBps;
  }

  // Apply volatility multiplier
  slippageBps *= volatilityMultiplier;

  // Clamp to min/max bounds
  slippageBps = Math.max(model.minBps, Math.min(model.maxBps, slippageBps));

  return slippageBps;
}

/**
 * Calculate entry slippage for a venue
 */
export function calculateEntrySlippage(
  config: VenueSlippageConfig,
  tradeSize: number,
  marketVolume24h: number = 0,
  volatilityLevel: number = 0
): number {
  const volatilityMultiplier = 1 + (config.volatilityMultiplier - 1) * Math.min(1, volatilityLevel);
  return calculateSlippage(config.entrySlippage, tradeSize, marketVolume24h, volatilityMultiplier);
}

/**
 * Calculate exit slippage for a venue
 */
export function calculateExitSlippage(
  config: VenueSlippageConfig,
  tradeSize: number,
  marketVolume24h: number = 0,
  volatilityLevel: number = 0
): number {
  const volatilityMultiplier = 1 + (config.volatilityMultiplier - 1) * Math.min(1, volatilityLevel);
  return calculateSlippage(config.exitSlippage, tradeSize, marketVolume24h, volatilityMultiplier);
}

/**
 * Create default slippage model for Pump.fun
 * Higher slippage due to lower liquidity
 */
export function createPumpfunSlippageConfig(): VenueSlippageConfig {
  return {
    venue: 'pumpfun',
    entrySlippage: {
      type: 'sqrt',
      fixedBps: 0,
      linearCoefficient: 0,
      sqrtCoefficient: 50, // 50 bps per sqrt(unit)
      volumeImpactBps: 0,
      minBps: 10,
      maxBps: 500,
    },
    exitSlippage: {
      type: 'sqrt',
      fixedBps: 0,
      linearCoefficient: 0,
      sqrtCoefficient: 75, // Higher exit slippage
      volumeImpactBps: 0,
      minBps: 15,
      maxBps: 750,
    },
    volatilityMultiplier: 1.5,
  };
}

/**
 * Create default slippage model for PumpSwap
 * Lower slippage due to better liquidity
 */
export function createPumpswapSlippageConfig(): VenueSlippageConfig {
  return {
    venue: 'pumpswap',
    entrySlippage: {
      type: 'sqrt',
      fixedBps: 0,
      linearCoefficient: 0,
      sqrtCoefficient: 30,
      volumeImpactBps: 0,
      minBps: 5,
      maxBps: 300,
    },
    exitSlippage: {
      type: 'sqrt',
      fixedBps: 0,
      linearCoefficient: 0,
      sqrtCoefficient: 40,
      volumeImpactBps: 0,
      minBps: 8,
      maxBps: 400,
    },
    volatilityMultiplier: 1.3,
  };
}
