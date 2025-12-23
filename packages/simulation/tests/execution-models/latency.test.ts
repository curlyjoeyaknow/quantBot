/**
 * Latency Model Tests
 */

import { describe, it, expect } from 'vitest';
import {
  sampleLatency,
  sampleNetworkLatency,
  sampleTotalLatency,
  createPumpfunLatencyConfig,
  createPumpswapLatencyConfig,
} from '../../src/execution-models/latency.js';
import type { LatencyDistribution } from '../../src/execution-models/types.js';
import { createDeterministicRNG } from '@quantbot/core';

describe('Latency Models', () => {
  describe('sampleLatency', () => {
    it('should sample from percentile distribution', () => {
      const dist: LatencyDistribution = {
        p50: 100,
        p90: 200,
        p99: 500,
        jitterMs: 10,
        distribution: 'percentile',
      };

      const rng = createDeterministicRNG(42);
      const samples = Array.from({ length: 1000 }, () => sampleLatency(dist, rng));

      // All samples should be non-negative
      expect(samples.every((s) => s >= 0)).toBe(true);

      // Median should be around p50
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      expect(median).toBeGreaterThan(80);
      expect(median).toBeLessThan(120);
    });

    it('should handle normal distribution', () => {
      const dist: LatencyDistribution = {
        p50: 0,
        p90: 0,
        p99: 0,
        jitterMs: 0,
        distribution: 'normal',
        meanMs: 100,
        stddevMs: 20,
      };

      const rng = createDeterministicRNG(43);
      const samples = Array.from({ length: 1000 }, () => sampleLatency(dist, rng));

      // All samples should be non-negative
      expect(samples.every((s) => s >= 0)).toBe(true);

      // Mean should be around 100
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      expect(mean).toBeGreaterThan(90);
      expect(mean).toBeLessThan(110);
    });
  });

  describe('sampleNetworkLatency', () => {
    it('should apply congestion multiplier', () => {
      const config = createPumpfunLatencyConfig();

      const rng1 = createDeterministicRNG(44);
      const rng2 = createDeterministicRNG(45);
      // Sample many times to get reliable average behavior
      const baseSamples = Array.from({ length: 1000 }, () => sampleNetworkLatency(config, rng1, 0));
      const congestedSamples = Array.from({ length: 1000 }, () =>
        sampleNetworkLatency(config, rng2, 1.0)
      );

      const baseAvg = baseSamples.reduce((a, b) => a + b, 0) / baseSamples.length;
      const congestedAvg = congestedSamples.reduce((a, b) => a + b, 0) / congestedSamples.length;

      // With congestionMultiplier=2.0 and congestionLevel=1.0, we expect roughly 2x
      // Allow some variance due to randomness, but should be clearly higher
      const ratio = congestedAvg / baseAvg;
      expect(ratio).toBeGreaterThan(1.3); // At least 30% higher on average
      expect(ratio).toBeLessThan(2.5); // But not more than 2.5x (allowing for variance)
    });
  });

  describe('sampleTotalLatency', () => {
    it('should combine network and confirmation latency', () => {
      const config = createPumpfunLatencyConfig();
      const rng = createDeterministicRNG(46);
      const total = sampleTotalLatency(config, rng, 0);

      // Total should be at least network latency
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThan(10000); // Sanity check
    });
  });

  describe('createPumpfunLatencyConfig', () => {
    it('should create valid config', () => {
      const config = createPumpfunLatencyConfig();
      expect(config.venue).toBe('pumpfun');
      expect(config.networkLatency.p50).toBeGreaterThan(0);
      expect(config.confirmationLatency.p50).toBeGreaterThan(0);
      expect(config.congestionMultiplier).toBeGreaterThan(1);
    });
  });

  describe('createPumpswapLatencyConfig', () => {
    it('should create valid config', () => {
      const config = createPumpswapLatencyConfig();
      expect(config.venue).toBe('pumpswap');
      expect(config.networkLatency.p50).toBeGreaterThan(0);
      expect(config.confirmationLatency.p50).toBeGreaterThan(0);
    });
  });
});
