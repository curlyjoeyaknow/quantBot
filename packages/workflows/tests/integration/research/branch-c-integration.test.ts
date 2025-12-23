/**
 * Integration tests for Branch C (Execution Reality) integration
 *
 * These tests verify that Branch A can work with Branch C's Execution/Cost/Risk models.
 * Branch C provides execution models from @quantbot/simulation/execution-models.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionRealityService } from '../../../src/research/services/ExecutionRealityService.js';
import type {
  ExecutionModel as ContractExecutionModel,
  CostModel as ContractCostModel,
  RiskModel as ContractRiskModel,
} from '../../../src/research/contract.js';

describe('Branch C Integration (Execution Reality)', () => {
  let service: ExecutionRealityService;

  beforeEach(() => {
    service = new ExecutionRealityService();
  });

  it('creates execution model from calibration data', () => {
    const calibration = {
      latencySamples: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500],
      slippageSamples: [
        { tradeSize: 100, expectedPrice: 100, actualPrice: 100.1 },
        { tradeSize: 200, expectedPrice: 100, actualPrice: 100.2 },
      ],
      failureRate: 0.01,
      partialFillRate: 0.05,
    };

    const model = service.createExecutionModelFromCalibration(calibration, 'pumpfun');

    // Verify model structure
    expect(model.latency).toBeDefined();
    expect(model.latency.p50).toBeGreaterThan(0);
    expect(model.latency.p90).toBeGreaterThanOrEqual(model.latency.p50);
    expect(model.latency.p99).toBeGreaterThanOrEqual(model.latency.p90);
    expect(model.slippage).toBeDefined();
    expect(model.slippage.base).toBeGreaterThanOrEqual(0);
    expect(model.failures).toBeDefined();
    expect(model.failures?.baseRate).toBeGreaterThanOrEqual(0);
  });

  it('creates cost model from fee data', () => {
    const fees = {
      baseFee: 5000,
      priorityFeeRange: { min: 1000, max: 10000 },
      tradingFeePercent: 0.01, // 1%
    };

    const model = service.createCostModelFromFees(fees);

    expect(model.baseFee).toBe(5000);
    expect(model.priorityFee).toBeDefined();
    expect(model.priorityFee?.base).toBe(1000);
    expect(model.priorityFee?.max).toBe(10000);
    expect(model.tradingFee).toBeCloseTo(0.01, 5);
  });

  it('creates risk model from constraints', () => {
    const constraints = {
      maxDrawdownPercent: 20,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
      maxTotalExposure: 2000,
      tradeThrottle: {
        maxTrades: 10,
        windowMinutes: 60,
      },
    };

    const model = service.createRiskModelFromConstraints(constraints);

    expect(model.maxDrawdown).toBeCloseTo(0.2, 5); // 20% = 0.2
    expect(model.maxLossPerDay).toBe(1000);
    expect(model.maxConsecutiveLosses).toBe(5);
    expect(model.maxPositionSize).toBe(500);
    expect(model.maxTotalExposure).toBe(2000);
    expect(model.tradeThrottle).toBeDefined();
    expect(model.tradeThrottle?.maxTrades).toBe(10);
    expect(model.tradeThrottle?.windowMinutes).toBe(60);
  });

  it('applies execution model to a trade', () => {
    // Create a simple execution model
    const calibration = {
      latencySamples: [100, 200, 300],
      slippageSamples: [{ tradeSize: 100, expectedPrice: 100, actualPrice: 100.1 }],
      failureRate: 0.01,
    };
    const model = service.createExecutionModelFromCalibration(calibration);

    // Apply to an entry trade
    const result = service.applyExecutionModel(
      {
        type: 'entry',
        asset: 'SOL',
        quantity: 100,
        expectedPrice: 100,
        marketVolume24h: 1_000_000,
        volatilityLevel: 0.3,
        congestionLevel: 0.5,
      },
      model,
      () => 0.5 // Deterministic random for testing
    );

    expect(result.executedPrice).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(typeof result.failed).toBe('boolean');
    expect(typeof result.partialFill).toBe('boolean');
  });

  it('applies cost model to a trade', () => {
    const fees = {
      baseFee: 5000,
      priorityFeeRange: { min: 1000, max: 10000 },
      tradingFeePercent: 0.01,
    };
    const model = service.createCostModelFromFees(fees);

    const cost = service.applyCostModel(
      {
        value: 100_000,
        priority: 'medium',
        congestionLevel: 0.5,
      },
      model
    );

    expect(cost).toBeGreaterThan(0);
    // Should include base fee + priority fee + trading fee
    expect(cost).toBeGreaterThanOrEqual(5000 + 1000); // base + min priority
  });

  it('checks risk model circuit breakers', () => {
    const constraints = {
      maxDrawdownPercent: 20,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
    };
    const model = service.createRiskModelFromConstraints(constraints);

    // Check drawdown circuit breaker (drawdown = (peak - current) / peak = (1000 - 750) / 1000 = 0.25 = 25%)
    const result = service.checkRiskConstraints(
      {
        currentDrawdown: 0.25, // 25% drawdown, exceeds 20% limit
        lossToday: -500,
        consecutiveLosses: 3,
        currentExposure: 400,
        tradesToday: 5,
        peakPnl: 1000,
        currentPnl: 750,
      },
      model,
      'test-strategy',
      100
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.hitLimit).toBeDefined();
  });

  it('handles edge cases in calibration', () => {
    // Test with minimal data
    const minimalCalibration = {
      latencySamples: [100, 200],
      slippageSamples: [{ tradeSize: 100, expectedPrice: 100, actualPrice: 100.1 }],
      failureRate: 0.0,
    };

    const model = service.createExecutionModelFromCalibration(minimalCalibration);
    expect(model.latency).toBeDefined();
    expect(model.slippage).toBeDefined();
  });

  it('validates contract model schemas', () => {
    const calibration = {
      latencySamples: [100, 200, 300],
      slippageSamples: [{ tradeSize: 100, expectedPrice: 100, actualPrice: 100.1 }],
      failureRate: 0.01,
    };

    const executionModel: ContractExecutionModel =
      service.createExecutionModelFromCalibration(calibration);
    const costModel: ContractCostModel = service.createCostModelFromFees({
      baseFee: 5000,
      priorityFeeRange: { min: 1000, max: 10000 },
      tradingFeePercent: 0.01,
    });
    const riskModel: ContractRiskModel = service.createRiskModelFromConstraints({
      maxDrawdownPercent: 20,
      maxLossPerDay: 1000,
      maxConsecutiveLosses: 5,
      maxPositionSize: 500,
    });

    // Verify models conform to contract schemas (types should match)
    expect(executionModel).toBeDefined();
    expect(costModel).toBeDefined();
    expect(riskModel).toBeDefined();
  });
});
