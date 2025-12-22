/**
 * Calibration Tool
 * ================
 * 
 * Tools for calibrating execution models from live trading data.
 */

import type {
  ExecutionModel,
  LatencyDistribution,
  SlippageModel,
  FailureModel,
} from './types.js';
import { z } from 'zod';

/**
 * Live trade execution record
 */
export const LiveTradeRecordSchema = z.object({
  /** Trade timestamp (ISO 8601 or Unix ms) */
  timestamp: z.union([z.string().datetime(), z.number()]),
  /** Venue identifier */
  venue: z.string(),
  /** Trade size */
  tradeSize: z.number().positive(),
  /** Market volume 24h (if available) */
  marketVolume24h: z.number().nonnegative().optional(),
  /** Expected price */
  expectedPrice: z.number().positive(),
  /** Actual fill price */
  actualPrice: z.number().positive(),
  /** Network latency in ms */
  networkLatencyMs: z.number().nonnegative().optional(),
  /** Confirmation latency in ms */
  confirmationLatencyMs: z.number().nonnegative().optional(),
  /** Transaction failed */
  failed: z.boolean().default(false),
  /** Partial fill percentage (0-1) */
  fillPercentage: z.number().min(0).max(1).default(1),
  /** Priority fee paid (micro-lamports per CU) */
  priorityFeeMicroLamports: z.number().nonnegative().optional(),
  /** Congestion level (0-1, if available) */
  congestionLevel: z.number().min(0).max(1).optional(),
  /** Volatility level (0-1, if available) */
  volatilityLevel: z.number().min(0).max(1).optional(),
});

export type LiveTradeRecord = z.infer<typeof LiveTradeRecordSchema>;

/**
 * Calibration result
 */
export interface CalibrationResult {
  /** Calibrated execution model */
  model: ExecutionModel;
  /** Sample size used */
  sampleSize: number;
  /** Calibration timestamp */
  calibratedAt: string;
  /** Source of calibration data */
  source: string;
  /** Calibration statistics */
  statistics: {
    latency: {
      networkP50: number;
      networkP90: number;
      networkP99: number;
      confirmationP50: number;
      confirmationP90: number;
      confirmationP99: number;
    };
    slippage: {
      entryMean: number;
      entryStddev: number;
      exitMean: number;
      exitStddev: number;
    };
    failures: {
      baseRate: number;
      congestionRate: number;
      feeShortfallRate: number;
    };
    partialFills: {
      probability: number;
      meanFill: number;
    };
  };
}

/**
 * Calibrate latency distribution from live data
 */
export function calibrateLatencyDistribution(
  latencies: number[]
): LatencyDistribution {
  if (latencies.length === 0) {
    throw new Error('Cannot calibrate latency distribution from empty data');
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;

  // Calculate jitter as standard deviation
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const variance = latencies.reduce((sum, val) => sum + (val - mean) ** 2, 0) / latencies.length;
  const stddev = Math.sqrt(variance);
  const jitterMs = stddev;

  return {
    p50,
    p90,
    p99,
    jitterMs,
    distribution: 'percentile',
  };
}

/**
 * Calibrate slippage model from live data
 */
export function calibrateSlippageModel(
  records: Array<{ tradeSize: number; expectedPrice: number; actualPrice: number; marketVolume24h?: number }>
): SlippageModel {
  if (records.length === 0) {
    throw new Error('Cannot calibrate slippage model from empty data');
  }

  // Calculate slippage in bps for each trade
  const slippages = records.map((r) => {
    const slippage = ((r.actualPrice - r.expectedPrice) / r.expectedPrice) * 10_000;
    return { tradeSize: r.tradeSize, slippageBps: slippage };
  });

  // Simple linear regression to find coefficient
  const n = slippages.length;
  const sumX = slippages.reduce((sum, r) => sum + Math.sqrt(r.tradeSize), 0);
  const sumY = slippages.reduce((sum, r) => sum + r.slippageBps, 0);
  const sumXY = slippages.reduce((sum, r) => sum + Math.sqrt(r.tradeSize) * r.slippageBps, 0);
  const sumX2 = slippages.reduce((sum, r) => sum + r.tradeSize, 0);

  const sqrtCoefficient = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const meanSlippage = sumY / n;

  return {
    type: 'sqrt',
    sqrtCoefficient: Math.max(0, sqrtCoefficient || 0),
    minBps: Math.min(...slippages.map((r) => r.slippageBps)),
    maxBps: Math.max(...slippages.map((r) => r.slippageBps)),
  };
}

/**
 * Calibrate failure model from live data
 */
export function calibrateFailureModel(
  records: Array<{ failed: boolean; congestionLevel?: number; priorityFeeShortfall?: number }>
): FailureModel {
  if (records.length === 0) {
    throw new Error('Cannot calibrate failure model from empty data');
  }

  const total = records.length;
  const failures = records.filter((r) => r.failed);
  const baseFailureRate = failures.length / total;

  // Separate by congestion level
  const withCongestion = records.filter((r) => r.congestionLevel !== undefined);
  const highCongestion = withCongestion.filter((r) => (r.congestionLevel || 0) > 0.5);
  const highCongestionFailures = highCongestion.filter((r) => r.failed);
  const congestionFailureRate =
    highCongestion.length > 0
      ? highCongestionFailures.length / highCongestion.length - baseFailureRate
      : 0;

  // Separate by fee shortfall
  const withFeeShortfall = records.filter((r) => r.priorityFeeShortfall !== undefined);
  const highFeeShortfall = withFeeShortfall.filter((r) => (r.priorityFeeShortfall || 0) > 0.5);
  const highFeeShortfallFailures = highFeeShortfall.filter((r) => r.failed);
  const feeShortfallFailureRate =
    highFeeShortfall.length > 0
      ? highFeeShortfallFailures.length / highFeeShortfall.length - baseFailureRate
      : 0;

  return {
    baseFailureRate: Math.max(0, baseFailureRate),
    congestionFailureRate: Math.max(0, congestionFailureRate),
    feeShortfallFailureRate: Math.max(0, feeShortfallFailureRate),
    maxFailureRate: 0.5,
  };
}

/**
 * Calibrate execution model from live trade records
 */
export function calibrateExecutionModel(
  records: LiveTradeRecord[],
  venue: string,
  source: string = 'live-trading'
): CalibrationResult {
  if (records.length === 0) {
    throw new Error('Cannot calibrate execution model from empty records');
  }

  // Filter by venue
  const venueRecords = records.filter((r) => r.venue === venue);
  if (venueRecords.length === 0) {
    throw new Error(`No records found for venue: ${venue}`);
  }

  // Calibrate latency
  const networkLatencies = venueRecords
    .map((r) => r.networkLatencyMs)
    .filter((l): l is number => l !== undefined);
  const confirmationLatencies = venueRecords
    .map((r) => r.confirmationLatencyMs)
    .filter((l): l is number => l !== undefined);

  const networkLatency = networkLatencies.length > 0
    ? calibrateLatencyDistribution(networkLatencies)
    : {
        p50: 50,
        p90: 150,
        p99: 500,
        jitterMs: 20,
        distribution: 'percentile' as const,
      };

  const confirmationLatency = confirmationLatencies.length > 0
    ? calibrateLatencyDistribution(confirmationLatencies)
    : {
        p50: 400,
        p90: 800,
        p99: 2000,
        jitterMs: 100,
        distribution: 'percentile' as const,
      };

  // Calibrate slippage
  const slippageRecords = venueRecords.filter(
    (r) => !r.failed && r.fillPercentage > 0
  );
  const entrySlippage = slippageRecords.length > 0
    ? calibrateSlippageModel(
        slippageRecords.map((r) => ({
          tradeSize: r.tradeSize,
          expectedPrice: r.expectedPrice,
          actualPrice: r.actualPrice,
          marketVolume24h: r.marketVolume24h,
        }))
      )
    : {
        type: 'fixed' as const,
        fixedBps: 0,
        minBps: 0,
        maxBps: 0,
      };

  // Calibrate failures
  const failureModel = calibrateFailureModel(
    venueRecords.map((r) => ({
      failed: r.failed,
      congestionLevel: r.congestionLevel,
      priorityFeeShortfall: r.priorityFeeShortfall,
    }))
  );

  // Calculate statistics
  const entrySlippages = slippageRecords.map((r) => {
    return ((r.actualPrice - r.expectedPrice) / r.expectedPrice) * 10_000;
  });
  const entryMean = entrySlippages.length > 0
    ? entrySlippages.reduce((a, b) => a + b, 0) / entrySlippages.length
    : 0;
  const entryStddev = entrySlippages.length > 0
    ? Math.sqrt(
        entrySlippages.reduce((sum, val) => sum + (val - entryMean) ** 2, 0) /
          entrySlippages.length
      )
    : 0;

  const partialFills = venueRecords.filter((r) => r.fillPercentage < 1);
  const partialFillProbability = venueRecords.length > 0
    ? partialFills.length / venueRecords.length
    : 0;
  const meanFill = partialFills.length > 0
    ? partialFills.reduce((sum, r) => sum + r.fillPercentage, 0) / partialFills.length
    : 1;

  // Build calibrated model
  const model: ExecutionModel = {
    id: `${venue}-calibrated-${Date.now()}`,
    name: `Calibrated Execution Model for ${venue}`,
    venue,
    latency: {
      venue,
      networkLatency,
      confirmationLatency,
      congestionMultiplier: 2.0, // Default, could be calibrated
    },
    slippage: {
      venue,
      entrySlippage,
      exitSlippage: entrySlippage, // Assume symmetric for now
      volatilityMultiplier: 1.5,
    },
    failures: failureModel,
    partialFills: {
      probability: partialFillProbability,
      fillDistribution: {
        type: 'uniform',
        minFill: 0.5,
        maxFill: 0.95,
      },
    },
    costs: {
      takerFeeBps: 25, // Default, could be calibrated from records
      makerFeeBps: 0,
      borrowAprBps: 0,
    },
    calibrationMetadata: {
      calibratedAt: new Date().toISOString(),
      source,
      sampleSize: venueRecords.length,
    },
  };

  return {
    model,
    sampleSize: venueRecords.length,
    calibratedAt: new Date().toISOString(),
    source,
    statistics: {
      latency: {
        networkP50: networkLatency.p50,
        networkP90: networkLatency.p90,
        networkP99: networkLatency.p99,
        confirmationP50: confirmationLatency.p50,
        confirmationP90: confirmationLatency.p90,
        confirmationP99: confirmationLatency.p99,
      },
      slippage: {
        entryMean,
        entryStddev,
        exitMean: entryMean, // Assume symmetric
        exitStddev: entryStddev,
      },
      failures: {
        baseRate: failureModel.baseFailureRate,
        congestionRate: failureModel.congestionFailureRate,
        feeShortfallRate: failureModel.feeShortfallFailureRate,
      },
      partialFills: {
        probability: partialFillProbability,
        meanFill,
      },
    },
  };
}

