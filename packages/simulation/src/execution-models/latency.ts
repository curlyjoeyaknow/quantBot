/**
 * Latency Distribution Models
 * ===========================
 *
 * Models for simulating network and confirmation latency in trading execution.
 */

import type { LatencyDistribution, VenueLatencyConfig } from './types.js';

/**
 * Sample latency from a percentile-based distribution
 * Uses interpolation between p50, p90, p99 based on random value
 */
export function sampleLatency(distribution: LatencyDistribution): number {
  const { distribution: distType, jitterMs } = distribution;

  let baseLatency: number;

  if (
    distType === 'normal' &&
    distribution.meanMs !== undefined &&
    distribution.stddevMs !== undefined
  ) {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    baseLatency = distribution.meanMs + z0 * distribution.stddevMs;
    baseLatency = Math.max(0, baseLatency); // Ensure non-negative
  } else {
    // Percentile-based distribution
    const r = Math.random();
    if (r < 0.5) {
      // 0-50th percentile: linear interpolation from 0 to p50
      baseLatency = (r / 0.5) * distribution.p50;
    } else if (r < 0.9) {
      // 50-90th percentile: linear interpolation from p50 to p90
      const t = (r - 0.5) / 0.4;
      baseLatency = distribution.p50 + t * (distribution.p90 - distribution.p50);
    } else {
      // 90-99th percentile: linear interpolation from p90 to p99
      const t = (r - 0.9) / 0.09;
      baseLatency = distribution.p90 + t * (distribution.p99 - distribution.p90);
    }
  }

  // Add jitter (uniform random)
  const jitter = jitterMs > 0 ? (Math.random() - 0.5) * 2 * jitterMs : 0;

  return Math.max(0, baseLatency + jitter);
}

/**
 * Sample network latency for a venue
 */
export function sampleNetworkLatency(
  config: VenueLatencyConfig,
  congestionLevel: number = 0
): number {
  const baseLatency = sampleLatency(config.networkLatency);
  const congestionMultiplier = 1 + (config.congestionMultiplier - 1) * Math.min(1, congestionLevel);
  return baseLatency * congestionMultiplier;
}

/**
 * Sample confirmation latency for a venue
 */
export function sampleConfirmationLatency(
  config: VenueLatencyConfig,
  congestionLevel: number = 0
): number {
  const baseLatency = sampleLatency(config.confirmationLatency);
  const congestionMultiplier = 1 + (config.congestionMultiplier - 1) * Math.min(1, congestionLevel);
  return baseLatency * congestionMultiplier;
}

/**
 * Sample total execution latency (network + confirmation)
 */
export function sampleTotalLatency(
  config: VenueLatencyConfig,
  congestionLevel: number = 0
): number {
  const network = sampleNetworkLatency(config, congestionLevel);
  const confirmation = sampleConfirmationLatency(config, congestionLevel);
  return network + confirmation;
}

/**
 * Create a default latency distribution for Pump.fun
 * Based on typical Solana RPC + confirmation times
 */
export function createPumpfunLatencyConfig(): VenueLatencyConfig {
  return {
    venue: 'pumpfun',
    networkLatency: {
      p50: 50, // 50ms median
      p90: 150, // 150ms at 90th percentile
      p99: 500, // 500ms at 99th percentile
      jitterMs: 20,
      distribution: 'percentile',
    },
    confirmationLatency: {
      p50: 400, // 400ms median (Solana ~400ms per slot)
      p90: 800, // 800ms at 90th percentile
      p99: 2000, // 2s at 99th percentile
      jitterMs: 100,
      distribution: 'percentile',
    },
    congestionMultiplier: 2.0, // 2x latency during congestion
  };
}

/**
 * Create a default latency distribution for PumpSwap (post-graduation)
 * Typically faster than Pump.fun due to better liquidity
 */
export function createPumpswapLatencyConfig(): VenueLatencyConfig {
  return {
    venue: 'pumpswap',
    networkLatency: {
      p50: 40,
      p90: 120,
      p99: 400,
      jitterMs: 15,
      distribution: 'percentile',
    },
    confirmationLatency: {
      p50: 400,
      p90: 750,
      p99: 1800,
      jitterMs: 80,
      distribution: 'percentile',
    },
    congestionMultiplier: 1.8,
  };
}
