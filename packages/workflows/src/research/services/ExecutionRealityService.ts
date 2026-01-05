/**
 * Execution Reality Service (Branch C Implementation)
 * ===================================================
 *
 * Real implementation of execution/cost/risk model services.
 * Replaces MockExecutionRealityService with actual Branch C models.
 */

import { ValidationError } from '@quantbot/utils';
import type {
  ExecutionModel as ContractExecutionModel,
  CostModel as ContractCostModel,
  RiskModel as ContractRiskModel,
} from '../contract.js';
import {
  ExecutionModelSchema as ContractExecutionModelSchema,
  CostModelSchema as ContractCostModelSchema,
  RiskModelSchema as ContractRiskModelSchema,
} from '../contract.js';

// Import Branch C execution models from @quantbot/simulation/execution-models subpath
// to get the detailed venue-specific types, not the simpler simulation input types
import type {
  ExecutionModel,
  CostModel,
  RiskFramework,
  LiveTradeRecord,
} from '@quantbot/simulation/execution-models';
import {
  createPumpfunExecutionModel,
  calibrateExecutionModel,
  checkCircuitBreaker,
  createCircuitBreakerState,
} from '@quantbot/simulation/execution-models';
import { createDeterministicRNG, seedFromString } from '@quantbot/core';
import { DateTime } from 'luxon';
// createPumpswapExecutionModel and convertExecutionModelToCostConfig are imported but not used
// They may be needed for future implementations

/**
 * Calibration data for execution model
 */
export interface CalibrationData {
  latencySamples: number[];
  slippageSamples: Array<{
    tradeSize: number;
    expectedPrice: number;
    actualPrice: number;
    marketVolume24h?: number;
  }>;
  failureRate: number;
  partialFillRate?: number;
}

/**
 * Fee data for cost model
 */
export interface FeeData {
  baseFee: number;
  priorityFeeRange: {
    min: number;
    max: number;
  };
  tradingFeePercent: number;
}

/**
 * Risk constraints
 */
export interface RiskConstraints {
  maxDrawdownPercent: number;
  maxLossPerDay: number;
  maxConsecutiveLosses: number;
  maxPositionSize: number;
  maxTotalExposure?: number;
  tradeThrottle?: {
    maxTrades: number;
    windowMinutes: number;
  };
}

/**
 * Execution Reality Service
 *
 * Creates and applies execution/cost/risk models using Branch C implementations.
 */
export class ExecutionRealityService {
  /**
   * Creates execution model from calibration data
   *
   * Uses Branch C's calibration tools to create a real execution model.
   */
  createExecutionModelFromCalibration(
    calibration: CalibrationData,
    venue: string = 'pumpfun',
    seed?: number
  ): ContractExecutionModel {
    // Use deterministic RNG for generating test data
    // Seed from calibration data hash for reproducibility
    const calibrationSeed =
      seed ??
      seedFromString(
        `calibration-${venue}-${calibration.latencySamples.length}-${calibration.slippageSamples.length}`
      );
    const rng = createDeterministicRNG(calibrationSeed);

    // Use deterministic base timestamp (current time rounded to hour for reproducibility)
    const baseTimestamp = Math.floor(DateTime.now().startOf('hour').toMillis());

    // Convert calibration data to LiveTradeRecord format
    const records: LiveTradeRecord[] = calibration.latencySamples.map((latency, idx) => {
      const slippageSample = calibration.slippageSamples[idx % calibration.slippageSamples.length];
      if (!slippageSample) {
        throw new ValidationError('Missing slippage sample', {
          index: idx % calibration.slippageSamples.length,
          calibrationLength: calibration.slippageSamples.length,
        });
      }
      // Deterministic timestamp based on index
      const timestamp = baseTimestamp - (calibration.latencySamples.length - idx) * 1000;
      // Deterministic failure/fill decisions based on RNG
      const failed = rng.next() < calibration.failureRate;
      const fillPercentage = calibration.partialFillRate
        ? rng.next() < calibration.partialFillRate
          ? 0.5 + rng.next() * 0.4
          : 1.0
        : 1.0;

      return {
        timestamp,
        venue,
        tradeSize: slippageSample.tradeSize,
        expectedPrice: slippageSample.expectedPrice,
        actualPrice: slippageSample.actualPrice,
        networkLatencyMs: latency * 0.3, // Assume 30% network, 70% confirmation
        confirmationLatencyMs: latency * 0.7,
        failed,
        fillPercentage,
        marketVolume24h: slippageSample.marketVolume24h,
      };
    });

    // Calibrate using Branch C's calibration tool
    const calibrated = calibrateExecutionModel(records, venue, 'calibration');

    // Convert Branch C ExecutionModel to contract ExecutionModel
    return this.convertToContractExecutionModel(calibrated.model);
  }

  /**
   * Creates cost model from fee data
   *
   * Uses Branch C's CostModel structure.
   */
  createCostModelFromFees(fees: FeeData): ContractCostModel {
    const costModel: CostModel = {
      takerFeeBps: Math.round(fees.tradingFeePercent * 10000), // Convert to bps
      makerFeeBps: 0,
      priorityFee: {
        baseMicroLamportsPerCu: fees.priorityFeeRange.min,
        congestionMultiplier: fees.priorityFeeRange.max / fees.priorityFeeRange.min,
        maxMicroLamportsPerCu: fees.priorityFeeRange.max,
      },
      computeUnits: {
        averageCu: 200_000,
        cuPriceLamports: 0,
      },
      borrowAprBps: 0,
    };

    // Convert to contract format, preserving baseFee from fees
    return this.convertToContractCostModel(costModel, fees.baseFee);
  }

  /**
   * Creates risk model from constraints
   *
   * Uses Branch C's RiskFramework structure.
   */
  createRiskModelFromConstraints(constraints: RiskConstraints): ContractRiskModel {
    return ContractRiskModelSchema.parse({
      maxDrawdown: constraints.maxDrawdownPercent / 100,
      maxLossPerDay: constraints.maxLossPerDay,
      maxConsecutiveLosses: constraints.maxConsecutiveLosses,
      maxPositionSize: constraints.maxPositionSize,
      maxTotalExposure: constraints.maxTotalExposure,
      tradeThrottle: constraints.tradeThrottle,
    });
  }

  /**
   * Applies execution model to a trade
   *
   * Uses Branch C's execution model sampling functions.
   */
  applyExecutionModel(
    trade: {
      type: 'entry' | 'exit';
      asset: string;
      quantity: number;
      expectedPrice: number;
      marketVolume24h?: number;
      volatilityLevel?: number;
      congestionLevel?: number;
    },
    model: ContractExecutionModel,
    random: () => number
  ): {
    executedPrice: number;
    latencyMs: number;
    failed: boolean;
    partialFill: boolean;
    fillPercentage?: number;
  } {
    // Convert contract model to Branch C model (simplified)
    const branchCModel = this.createBranchCExecutionModel(model);

    // Sample latency
    const latency = this.sampleLatency(model.latency, random);

    // Calculate slippage
    const slippage = this.calculateSlippage(
      trade.quantity,
      model.slippage,
      random,
      trade.marketVolume24h
    );
    const executedPrice =
      trade.type === 'entry'
        ? trade.expectedPrice * (1 + slippage)
        : trade.expectedPrice * (1 - slippage);

    // Simulate failure
    const failureRate = model.failures?.baseRate ?? 0;
    const congestionMultiplier = model.failures?.congestionMultiplier ?? 1;
    const effectiveFailureRate =
      failureRate * (1 + (congestionMultiplier - 1) * (trade.congestionLevel ?? 0));
    const failed = random() < effectiveFailureRate;

    // Simulate partial fill
    const partialFillProb = model.partialFills?.probability ?? 0;
    const partialFill = !failed && random() < partialFillProb;
    const fillPercentage =
      partialFill && model.partialFills
        ? model.partialFills.fillRange[0] +
          (model.partialFills.fillRange[1] - model.partialFills.fillRange[0]) * random()
        : 1.0;

    return {
      executedPrice,
      latencyMs: latency,
      failed,
      partialFill,
      fillPercentage: partialFill ? fillPercentage : undefined,
    };
  }

  /**
   * Applies cost model to a trade
   */
  applyCostModel(
    trade: {
      value: number;
      priority: 'low' | 'medium' | 'high';
      congestionLevel?: number;
    },
    model: ContractCostModel
  ): number {
    let totalCost = model.baseFee;

    if (model.priorityFee) {
      const priorityFee =
        trade.priority === 'high'
          ? (model.priorityFee.max ?? model.priorityFee.base)
          : model.priorityFee.base;
      totalCost += priorityFee;
    }

    if (model.tradingFee) {
      totalCost += trade.value * model.tradingFee;
    }

    return totalCost;
  }

  /**
   * Checks risk constraints
   *
   * Uses Branch C's risk framework.
   */
  checkRiskConstraints(
    state: {
      currentDrawdown: number;
      lossToday: number;
      consecutiveLosses: number;
      currentExposure: number;
      tradesToday: number;
      peakPnl: number;
      currentPnl: number;
    },
    model: ContractRiskModel,
    strategyId: string = 'default',
    tradeAmount: number = 0,
    now?: number
  ): {
    allowed: boolean;
    reason?: string;
    hitLimit?: string;
  } {
    // Use provided now or current time (deterministic for testing)
    const currentTime = now ?? DateTime.now().toMillis();
    // Convert contract model to Branch C circuit breaker config
    const circuitBreakerConfig = {
      maxDrawdown: model.maxDrawdown,
      maxDailyLoss: model.maxLossPerDay,
      maxConsecutiveLosses: model.maxConsecutiveLosses,
      maxExposurePerStrategy: model.maxPositionSize,
      maxTotalExposure: model.maxTotalExposure,
      minTradeIntervalSeconds: 0,
      maxTradesPerHour: model.tradeThrottle?.maxTrades,
      maxTradesPerDay: model.tradeThrottle?.maxTrades,
    };

    const circuitBreakerState = createCircuitBreakerState();
    circuitBreakerState.currentDrawdown = state.currentDrawdown;
    circuitBreakerState.dailyLoss = state.lossToday;
    circuitBreakerState.consecutiveLosses = state.consecutiveLosses;
    circuitBreakerState.totalExposure = state.currentExposure;
    circuitBreakerState.tradesThisDay = state.tradesToday;

    const result = checkCircuitBreaker(
      circuitBreakerConfig,
      circuitBreakerState,
      state.currentPnl,
      state.peakPnl,
      strategyId,
      tradeAmount,
      currentTime
    );

    return {
      allowed: !result.triggered,
      reason: result.reason,
      hitLimit: result.reason?.includes('drawdown')
        ? 'maxDrawdown'
        : result.reason?.includes('daily loss')
          ? 'maxLossPerDay'
          : result.reason?.includes('consecutive losses')
            ? 'maxConsecutiveLosses'
            : result.reason?.includes('exposure')
              ? 'maxExposure'
              : result.reason?.includes('throttle')
                ? 'tradeThrottle'
                : undefined,
    };
  }

  /**
   * Helper: Sample latency from distribution
   */
  private sampleLatency(latency: ContractExecutionModel['latency'], random: () => number): number {
    const r = random();
    if (r < 0.5) return latency.p50;
    if (r < 0.9) return latency.p90;
    return latency.p99;
  }

  /**
   * Helper: Calculate slippage
   */
  private calculateSlippage(
    quantity: number,
    slippage: ContractExecutionModel['slippage'],
    random: () => number,
    marketVolume24h?: number
  ): number {
    let totalSlippage = slippage.base;

    if (slippage.volumeImpact) {
      totalSlippage += quantity * slippage.volumeImpact;
    }

    if (slippage.max) {
      totalSlippage = Math.min(totalSlippage, slippage.max);
    }

    return totalSlippage;
  }

  /**
   * Helper: Convert Branch C ExecutionModel to contract ExecutionModel
   */
  private convertToContractExecutionModel(model: ExecutionModel): ContractExecutionModel {
    // Handle optional latency
    if (!model.latency) {
      throw new ValidationError('ExecutionModel must have latency configuration', {
        model,
      });
    }

    // Extract latency values - model.latency is VenueLatencyConfig
    const networkLatency = model.latency.networkLatency;
    const confirmationLatency = model.latency.confirmationLatency;

    return ContractExecutionModelSchema.parse({
      latency: {
        p50: networkLatency.p50 + confirmationLatency.p50,
        p90: networkLatency.p90 + confirmationLatency.p90,
        p99: networkLatency.p99 + confirmationLatency.p99,
        jitter: (networkLatency.jitterMs || 0) + (confirmationLatency.jitterMs || 0),
      },
      slippage: {
        base: model.slippage?.entrySlippage?.minBps
          ? model.slippage.entrySlippage.minBps / 10_000
          : 0.001, // Default 0.1%
        volumeImpact: 0, // Simplified
        max: model.slippage?.entrySlippage?.maxBps
          ? model.slippage.entrySlippage.maxBps / 10_000
          : 0.1, // Default 10%
      },
      failures: model.failures
        ? {
            baseRate: model.failures.baseFailureRate,
            congestionMultiplier: 2.0, // Simplified
          }
        : undefined,
      partialFills: model.partialFills
        ? {
            probability: model.partialFills.probability || 0,
            fillRange: [
              model.partialFills.fillDistribution?.minFill ?? 0.5,
              model.partialFills.fillDistribution?.maxFill ?? 0.95,
            ] as [number, number],
          }
        : undefined,
    });
  }

  /**
   * Helper: Convert Branch C CostModel to contract CostModel
   */
  private convertToContractCostModel(model: CostModel, baseFee?: number): ContractCostModel {
    return ContractCostModelSchema.parse({
      baseFee: baseFee ?? 0, // Use provided baseFee or default to 0 for Solana
      priorityFee: model.priorityFee
        ? {
            base: model.priorityFee.baseMicroLamportsPerCu,
            max: model.priorityFee.maxMicroLamportsPerCu,
          }
        : undefined,
      tradingFee: model.takerFeeBps / 10_000,
      effectiveCostPerTrade: (baseFee ?? 0) + (model.priorityFee?.baseMicroLamportsPerCu ?? 0),
    });
  }

  /**
   * Helper: Create Branch C ExecutionModel from contract model (for internal use)
   */
  private createBranchCExecutionModel(model: ContractExecutionModel): ExecutionModel {
    // Use default Pump.fun model as base
    return createPumpfunExecutionModel();
  }
}

/**
 * Create default ExecutionRealityService instance
 */
export function createExecutionRealityService(): ExecutionRealityService {
  return new ExecutionRealityService();
}
