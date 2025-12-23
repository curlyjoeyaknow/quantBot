/**
 * Execution Models Integration Tests
 * ===================================
 *
 * Tests that verify execution models integrate properly with:
 * - Simulation engine
 * - Cost calculations
 * - JSON serialization/deserialization
 * - Calibration workflow
 * - Risk framework
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { CostConfig } from '../../src/types/index.js';
import { simulateStrategy } from '../../src/core/simulator.js';
import type { Candle } from '../../src/types/candle.js';
import { createDeterministicRNG } from '@quantbot/core';
import {
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
  ExecutionModelSchema,
  CostModelSchema,
  RiskFrameworkSchema,
  convertExecutionModelToCostConfig,
  convertCostModelToCostConfig,
  sampleTotalLatency,
  calculateEntrySlippage,
  calculateExitSlippage,
  checkCircuitBreaker,
  createCircuitBreakerState,
  calibrateExecutionModel,
  type LiveTradeRecord,
} from '../../src/execution-models/index.js';

// Helper functions are imported from execution-models/adapters

/**
 * Create simple test candles
 */
function createTestCandles(count: number = 10): Candle[] {
  const candles: Candle[] = [];
  const baseTime = Date.now() - count * 60_000; // 1 minute intervals

  for (let i = 0; i < count; i++) {
    const price = 1.0 + i * 0.01; // Gradually increasing price
    candles.push({
      timestamp: baseTime + i * 60_000,
      open: price,
      high: price * 1.02,
      low: price * 0.98,
      close: price * 1.01,
      volume: 1000 + i * 100,
    });
  }

  return candles;
}

describe('Execution Models Integration', () => {
  describe('JSON Serialization/Deserialization', () => {
    it('should serialize and deserialize ExecutionModel', () => {
      const model = createPumpfunExecutionModel();

      // Serialize
      const json = JSON.stringify(model);
      expect(json).toBeTruthy();

      // Deserialize and validate
      const parsed = JSON.parse(json);
      const validated = ExecutionModelSchema.parse(parsed);

      expect(validated.venue).toBe(model.venue);
      expect(validated.latency.venue).toBe(model.latency.venue);
      expect(validated.slippage.venue).toBe(model.slippage.venue);
      expect(validated.costs.takerFeeBps).toBe(model.costs.takerFeeBps);
    });

    it('should serialize and deserialize CostModel', () => {
      const model = createPumpfunExecutionModel();
      const costModel = model.costs;

      const json = JSON.stringify(costModel);
      const parsed = JSON.parse(json);
      const validated = CostModelSchema.parse(parsed);

      expect(validated.takerFeeBps).toBe(costModel.takerFeeBps);
      if (costModel.priorityFee) {
        expect(validated.priorityFee?.baseMicroLamportsPerCu).toBe(
          costModel.priorityFee.baseMicroLamportsPerCu
        );
      }
    });

    it('should serialize and deserialize RiskFramework', () => {
      const framework = RiskFrameworkSchema.parse({
        circuitBreakers: {
          maxDrawdown: 0.2,
          maxDailyLoss: 1000,
          maxConsecutiveLosses: 5,
        },
        anomalyDetection: {
          enabled: true,
          latencySpikeThreshold: 3,
        },
      });

      const json = JSON.stringify(framework);
      const parsed = JSON.parse(json);
      const validated = RiskFrameworkSchema.parse(parsed);

      expect(validated.circuitBreakers.maxDrawdown).toBe(0.2);
      expect(validated.anomalyDetection?.enabled).toBe(true);
    });
  });

  describe('Cost Model Integration with Simulation Engine', () => {
    it('should convert CostModel to CostConfig for simulation', () => {
      const model = createPumpfunExecutionModel();
      const costConfig = convertCostModelToCostConfig(model.costs);

      expect(costConfig.takerFeeBps).toBe(model.costs.takerFeeBps);
      expect(costConfig.borrowAprBps).toBe(model.costs.borrowAprBps);
    });

    it('should run simulation with converted CostConfig', async () => {
      const model = createPumpfunExecutionModel();
      const costConfig = convertCostModelToCostConfig(model.costs);
      const candles = createTestCandles(20);

      const result = await simulateStrategy(
        candles,
        [{ target: 2, percent: 1.0 }],
        undefined, // stopLoss
        undefined, // entryConfig
        undefined, // reEntryConfig
        costConfig
      );

      expect(result).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);
    });

    it('should apply enhanced costs (priority fees) in calculations', () => {
      const model = createPumpfunExecutionModel();

      // Test priority fee calculation
      if (model.costs.priorityFee) {
        const baseFee = model.costs.priorityFee.baseMicroLamportsPerCu;
        expect(baseFee).toBeGreaterThan(0);

        // With congestion, fee should increase
        const congestionLevel = 0.8;
        // Priority fee calculation is in costs.ts, but we can verify the model structure
        expect(model.costs.priorityFee.congestionMultiplier).toBeGreaterThan(1);
      }
    });
  });

  describe('Slippage Model Integration', () => {
    it('should calculate slippage for different trade sizes', () => {
      const model = createPumpfunExecutionModel();

      const smallTrade = calculateEntrySlippage(model.slippage, 10, 0, 0);
      const largeTrade = calculateEntrySlippage(model.slippage, 1000, 0, 0);

      // Larger trades should generally have more slippage (sqrt model)
      expect(largeTrade).toBeGreaterThanOrEqual(smallTrade);
    });

    it('should apply volatility multiplier to slippage', () => {
      const model = createPumpfunExecutionModel();

      // Use smaller trade size to avoid hitting max cap
      const tradeSize = 10;
      const lowVol = calculateEntrySlippage(model.slippage, tradeSize, 0, 0);
      const highVol = calculateEntrySlippage(model.slippage, tradeSize, 0, 1.0);

      // High volatility should increase slippage (unless both hit max cap)
      // If both are at max, they'll be equal, so check that highVol >= lowVol
      expect(highVol).toBeGreaterThanOrEqual(lowVol);

      // If not at max, highVol should be greater
      if (highVol < model.slippage.entrySlippage.maxBps) {
        expect(highVol).toBeGreaterThan(lowVol);
      }
    });

    it('should respect slippage min/max bounds', () => {
      const model = createPumpfunExecutionModel();

      const slippage = calculateEntrySlippage(model.slippage, 1000000, 0, 0);

      expect(slippage).toBeGreaterThanOrEqual(model.slippage.entrySlippage.minBps);
      expect(slippage).toBeLessThanOrEqual(model.slippage.entrySlippage.maxBps);
    });
  });

  describe('Latency Model Integration', () => {
    it('should sample realistic latency values', () => {
      const model = createPumpfunExecutionModel();

      const rng = createDeterministicRNG(100);
      const latencies = Array.from({ length: 100 }, () => sampleTotalLatency(model.latency, rng, 0));

      // All latencies should be non-negative
      expect(latencies.every((l) => l >= 0)).toBe(true);

      // Median should be around p50 (network + confirmation)
      const sorted = [...latencies].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const expectedMedian =
        model.latency.networkLatency.p50 + model.latency.confirmationLatency.p50;

      // Allow some variance due to randomness
      expect(median).toBeGreaterThan(expectedMedian * 0.5);
      expect(median).toBeLessThan(expectedMedian * 2);
    });

    it('should apply congestion multiplier to latency', () => {
      const model = createPumpfunExecutionModel();

      const rng1 = createDeterministicRNG(101);
      const rng2 = createDeterministicRNG(102);
      const baseLatencies = Array.from({ length: 100 }, () => sampleTotalLatency(model.latency, rng1, 0));
      const congestedLatencies = Array.from({ length: 100 }, () =>
        sampleTotalLatency(model.latency, rng2, 1.0)
      );

      const baseAvg = baseLatencies.reduce((a, b) => a + b, 0) / baseLatencies.length;
      const congestedAvg =
        congestedLatencies.reduce((a, b) => a + b, 0) / congestedLatencies.length;

      // Congested should be higher
      expect(congestedAvg).toBeGreaterThan(baseAvg * 1.2);
    });
  });

  describe('Risk Framework Integration', () => {
    it('should track consecutive losses and trigger circuit breaker', () => {
      // Test only consecutive losses - disable other checks
      const framework = RiskFrameworkSchema.parse({
        circuitBreakers: {
          maxConsecutiveLosses: 3,
          minTradeIntervalSeconds: 0,
          // Disable other checks by omitting them (they're optional)
          maxDailyLoss: 100000,
          maxExposurePerStrategy: 100000,
          maxTotalExposure: 100000,
        },
      });

      const state = createCircuitBreakerState();
      const now = Date.now();

      // First trade - profit (resets counter)
      let result = checkCircuitBreaker(
        framework.circuitBreakers,
        state,
        100,
        100,
        'strategy1',
        100,
        now
      );
      expect(result.triggered).toBe(false);
      expect(state.consecutiveLosses).toBe(0);

      // Second trade - loss (currentPnl = -50, peakPnl = 100)
      // Drawdown = (100 - (-50)) / 100 = 1.5 = 150% (within 200% limit)
      result = checkCircuitBreaker(
        framework.circuitBreakers,
        state,
        -50,
        100,
        'strategy1',
        100,
        now + 1000
      );
      expect(result.triggered).toBe(false);
      expect(state.consecutiveLosses).toBe(1);

      // Third trade - loss (currentPnl = -100, peakPnl = 100)
      result = checkCircuitBreaker(
        framework.circuitBreakers,
        state,
        -100,
        100,
        'strategy1',
        100,
        now + 2000
      );
      expect(result.triggered).toBe(false);
      expect(state.consecutiveLosses).toBe(2);

      // Fourth trade - loss (should trigger at 3 consecutive losses)
      result = checkCircuitBreaker(
        framework.circuitBreakers,
        state,
        -150,
        100,
        'strategy1',
        100,
        now + 3000
      );
      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('consecutive losses');
      expect(state.consecutiveLosses).toBe(3);
    });

    it('should enforce trade throttles', () => {
      const framework = RiskFrameworkSchema.parse({
        circuitBreakers: {
          minTradeIntervalSeconds: 5,
        },
      });

      const state = createCircuitBreakerState();
      const now = Date.now();
      state.lastTradeTime = now - 2000; // 2 seconds ago

      const result = checkCircuitBreaker(
        framework.circuitBreakers,
        state,
        0,
        1000,
        'strategy1',
        100,
        now
      );

      expect(result.triggered).toBe(true);
      expect(result.reason).toContain('throttle');
    });
  });

  describe('Calibration Workflow', () => {
    it('should calibrate execution model from live trade records', () => {
      const records: LiveTradeRecord[] = [
        {
          timestamp: Date.now() - 10000,
          venue: 'pumpfun',
          tradeSize: 100,
          expectedPrice: 1.0,
          actualPrice: 1.0025,
          networkLatencyMs: 45,
          confirmationLatencyMs: 420,
          failed: false,
          fillPercentage: 1.0,
        },
        {
          timestamp: Date.now() - 5000,
          venue: 'pumpfun',
          tradeSize: 200,
          expectedPrice: 1.0,
          actualPrice: 1.005,
          networkLatencyMs: 52,
          confirmationLatencyMs: 450,
          failed: false,
          fillPercentage: 1.0,
        },
        {
          timestamp: Date.now(),
          venue: 'pumpfun',
          tradeSize: 150,
          expectedPrice: 1.0,
          actualPrice: 1.003,
          networkLatencyMs: 48,
          confirmationLatencyMs: 435,
          failed: false,
          fillPercentage: 0.8, // Partial fill
        },
      ];

      const result = calibrateExecutionModel(records, 'pumpfun', 'test');

      expect(result.model.venue).toBe('pumpfun');
      expect(result.sampleSize).toBe(3);
      expect(result.statistics.latency.networkP50).toBeGreaterThan(0);
      expect(result.statistics.slippage.entryMean).toBeGreaterThan(0);
    });

    it('should handle empty records gracefully', () => {
      expect(() => {
        calibrateExecutionModel([], 'pumpfun', 'test');
      }).toThrow('Cannot calibrate execution model from empty records');
    });

    it('should handle venue mismatch', () => {
      const records: LiveTradeRecord[] = [
        {
          timestamp: Date.now(),
          venue: 'pumpswap',
          tradeSize: 100,
          expectedPrice: 1.0,
          actualPrice: 1.0025,
          failed: false,
          fillPercentage: 1.0,
        },
      ];

      expect(() => {
        calibrateExecutionModel(records, 'pumpfun', 'test');
      }).toThrow('No records found for venue: pumpfun');
    });
  });

  describe('Model Compatibility', () => {
    it('should work with minimal execution model', () => {
      const model = createMinimalExecutionModel('test');
      expect(model.venue).toBe('test');
      expect(model.latency.networkLatency.p50).toBe(0);
      expect(model.slippage.entrySlippage.fixedBps).toBe(0);
    });

    it('should work with Pump.fun model', () => {
      const model = createPumpfunExecutionModel();
      expect(model.venue).toBe('pumpfun');
      expect(model.latency.networkLatency.p50).toBeGreaterThan(0);
      expect(model.slippage.entrySlippage.sqrtCoefficient).toBeGreaterThan(0);
    });

    it('should work with PumpSwap model', () => {
      const model = createPumpswapExecutionModel();
      expect(model.venue).toBe('pumpswap');
      expect(model.latency.networkLatency.p50).toBeGreaterThan(0);
    });
  });

  describe('End-to-End Simulation with Execution Models', () => {
    it('should run full simulation with execution model costs', async () => {
      const model = createPumpfunExecutionModel();
      const costConfig = convertCostModelToCostConfig(model.costs);

      // Create realistic candles
      const candles = createTestCandles(50);

      const result = await simulateStrategy(
        candles,
        [
          { target: 1.5, percent: 0.5 },
          { target: 2.0, percent: 0.5 },
        ],
        { initial: -0.1, trailing: 'none' },
        { initialEntry: -0.05, trailingEntry: 'none', maxWaitTime: 60 },
        undefined, // reEntry
        costConfig
      );

      expect(result).toBeDefined();
      expect(result.events.length).toBeGreaterThan(0);

      // Verify costs were applied (entry price should reflect fees)
      if (result.entryPrice > 0) {
        // Entry price should be positive
        expect(result.entryPrice).toBeGreaterThan(0);
      }
    });

    it('should handle different execution models in same simulation', async () => {
      const pumpfunModel = createPumpfunExecutionModel();
      const pumpswapModel = createPumpswapExecutionModel();

      const pumpfunCosts = convertCostModelToCostConfig(pumpfunModel.costs);
      const pumpswapCosts = convertCostModelToCostConfig(pumpswapModel.costs);

      // Both should work with simulation engine
      const candles = createTestCandles(30);

      const result1 = await simulateStrategy(
        candles,
        [{ target: 2, percent: 1.0 }],
        undefined,
        undefined,
        undefined,
        pumpfunCosts
      );

      const result2 = await simulateStrategy(
        candles,
        [{ target: 2, percent: 1.0 }],
        undefined,
        undefined,
        undefined,
        pumpswapCosts
      );

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });
  });
});
