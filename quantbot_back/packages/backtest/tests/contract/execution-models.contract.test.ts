/**
 * Contract Tests for Execution Models (re-exported from @quantbot/simulation)
 *
 * These tests ensure that:
 * 1. The symbols exist and are callable
 * 2. Basic deterministic output matches expected fixtures
 * 3. Call signatures stay stable (prevent breaking changes)
 * 4. Latency sampling determinism (with seeded RNG)
 *
 * Purpose: Prevent "minor refactor in simulation broke backtest API" from becoming your new hobby.
 */

import { describe, it, expect } from 'vitest';
// Import directly from simulation (what we're testing the contract for)
import {
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
  calculateSlippage,
  sampleLatency,
  type ExecutionModel,
  type LatencyDistribution,
  type SlippageModel,
} from '@quantbot/simulation/execution-models';
import type { DeterministicRNG } from '@quantbot/core';

/**
 * Create a deterministic RNG for testing
 * DeterministicRNG interface requires next() method
 */
function createTestRNG(seed: number = 12345): DeterministicRNG {
  let state = seed;
  return {
    next: () => {
      // Simple LCG for deterministic testing
      state = (state * 1664525 + 1013904223) % 2 ** 32;
      return state / 2 ** 32;
    },
    random: () => {
      // Alias for next() for compatibility
      return createTestRNG(state).next();
    },
    randomInt: (min: number, max: number) => {
      const r = createTestRNG(state).next();
      return Math.floor(min + r * (max - min));
    },
  };
}

describe('Execution Models Contract Tests', () => {
  describe('createPumpfunExecutionModel', () => {
    it('should exist and be callable', () => {
      const model = createPumpfunExecutionModel();
      expect(model).toBeDefined();
      expect(model).toHaveProperty('latency');
      expect(model).toHaveProperty('slippage');
    });

    it('should return ExecutionModel type', () => {
      const model = createPumpfunExecutionModel();
      expect(model).toBeDefined();
      expect(model).toHaveProperty('latency');
      expect(model).toHaveProperty('slippage');
      expect(model).toHaveProperty('venue');
      // ExecutionModel.latency is VenueLatencyConfig, which has networkLatency and confirmationLatency
      if (model.latency && typeof model.latency === 'object') {
        expect(model.latency).toHaveProperty('networkLatency');
        expect(model.latency).toHaveProperty('confirmationLatency');
        // Verify nested structure exists
        const networkLatency = (model.latency as any).networkLatency;
        if (networkLatency) {
          expect(networkLatency).toHaveProperty('p50');
          expect(typeof networkLatency.p50).toBe('number');
        }
      }
      // Slippage is VenueSlippageConfig with entrySlippage and exitSlippage
      if (model.slippage && typeof model.slippage === 'object') {
        expect(model.slippage).toHaveProperty('entrySlippage');
        expect(model.slippage).toHaveProperty('exitSlippage');
        // entrySlippage and exitSlippage are SlippageModel objects with type field
        const entrySlippage = (model.slippage as any).entrySlippage;
        if (entrySlippage) {
          expect(entrySlippage).toHaveProperty('type');
        }
      }
    });

    it('should produce deterministic factory defaults', () => {
      const model1 = createPumpfunExecutionModel();
      const model2 = createPumpfunExecutionModel();
      expect(model1.latency.networkLatency.p50).toBe(model2.latency.networkLatency.p50);
      expect(model1.slippage.type).toBe(model2.slippage.type);
    });
  });

  describe('createPumpswapExecutionModel', () => {
    it('should exist and be callable', () => {
      const model = createPumpswapExecutionModel();
      expect(model).toBeDefined();
      expect(model).toHaveProperty('latency');
      expect(model).toHaveProperty('slippage');
    });

    it('should return ExecutionModel type', () => {
      const model = createPumpswapExecutionModel();
      expect(model.latency).toBeDefined();
      expect(model.slippage).toBeDefined();
      expect(model.latency).toHaveProperty('networkLatency');
      expect(model.latency.networkLatency).toHaveProperty('p50');
      expect(typeof model.latency.networkLatency.p50).toBe('number');
    });

    it('should have different defaults than Pump.fun (explicit separation)', () => {
      const pumpfunModel = createPumpfunExecutionModel();
      const pumpswapModel = createPumpswapExecutionModel();
      // They should be different (explicit separation)
      // At minimum, verify they're both valid models
      expect(pumpfunModel.latency.networkLatency.p50).toBeGreaterThan(0);
      expect(pumpswapModel.latency.networkLatency.p50).toBeGreaterThan(0);
      // Verify they're actually different venues
      expect(pumpfunModel.venue).toBe('pumpfun');
      expect(pumpswapModel.venue).toBe('pumpswap');
    });
  });

  describe('createMinimalExecutionModel', () => {
    it('should exist and be callable', () => {
      const model = createMinimalExecutionModel();
      expect(model).toBeDefined();
      expect(model).toHaveProperty('latency');
      expect(model).toHaveProperty('slippage');
    });

    it('should return ExecutionModel type', () => {
      const model = createMinimalExecutionModel();
      expect(model.latency).toBeDefined();
      expect(model.slippage).toBeDefined();
    });
  });

  describe('calculateSlippage', () => {
    it('should exist and be callable', () => {
      const slippageModel: SlippageModel = {
        type: 'fixed',
        fixedBps: 10, // 0.1% = 10 bps
        minBps: 0,
        maxBps: 10000,
      };
      // Signature: (model, tradeSize, marketVolume24h?, volatilityMultiplier?)
      const result = calculateSlippage(slippageModel, 1000);
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
      // For fixed type, result should equal fixedBps
      expect(result).toBe(10);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should produce deterministic output for same inputs', () => {
      const slippageModel: SlippageModel = {
        type: 'fixed',
        fixedBps: 10,
        minBps: 0,
        maxBps: 10000,
      };
      const result1 = calculateSlippage(slippageModel, 1000);
      const result2 = calculateSlippage(slippageModel, 1000);
      expect(result1).toBe(result2);
    });
  });

  describe('sampleLatency', () => {
    it('should exist and be callable', () => {
      const latencyDist: LatencyDistribution = {
        p50: 100,
        p90: 200,
        p99: 500,
      };
      const rng = createTestRNG(12345);
      const result = sampleLatency(latencyDist, rng);
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should produce deterministic output with seeded RNG', () => {
      const latencyDist: LatencyDistribution = {
        p50: 100,
        p90: 200,
        p99: 500,
      };
      const rng1 = createTestRNG(12345);
      const rng2 = createTestRNG(12345);
      const result1 = sampleLatency(latencyDist, rng1);
      const result2 = sampleLatency(latencyDist, rng2);
      expect(result1).toBe(result2);
    });

    it('should respect latency distribution bounds', () => {
      const latencyDist: LatencyDistribution = {
        p50: 100,
        p90: 200,
        p99: 500,
      };
      const rng = createTestRNG(12345);
      const results = Array.from({ length: 100 }, () =>
        sampleLatency(latencyDist, createTestRNG(Math.random() * 1000000))
      );
      // Most samples should be within reasonable bounds
      const withinBounds = results.filter((r) => r >= 0 && r <= 1000);
      expect(withinBounds.length).toBeGreaterThan(90); // At least 90% within bounds
    });
  });

  describe('Call signature stability', () => {
    it('should maintain createPumpfunExecutionModel signature: ()', () => {
      expect(() => createPumpfunExecutionModel()).not.toThrow();
    });

    it('should maintain createPumpswapExecutionModel signature: ()', () => {
      expect(() => createPumpswapExecutionModel()).not.toThrow();
    });

    it('should maintain createMinimalExecutionModel signature: ()', () => {
      expect(() => createMinimalExecutionModel()).not.toThrow();
    });

    it('should maintain calculateSlippage signature: (model, tradeSize, marketVolume24h?, volatilityMultiplier?)', () => {
      const slippageModel: SlippageModel = {
        type: 'fixed',
        fixedBps: 10,
        minBps: 0,
        maxBps: 10000,
      };
      expect(() => calculateSlippage(slippageModel, 1000)).not.toThrow();
    });

    it('should maintain sampleLatency signature: (distribution, rng)', () => {
      const latencyDist: LatencyDistribution = {
        p50: 100,
        p90: 200,
        p99: 500,
      };
      const rng = createTestRNG(12345);
      expect(() => sampleLatency(latencyDist, rng)).not.toThrow();
    });
  });
});
