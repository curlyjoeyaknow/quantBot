/**
 * Analytics Types
 * ===============
 * Core types for historical analytics and performance metrics.
 */

/**
 * Call performance data
 */
export interface CallPerformance {
  callId: number;
  tokenAddress: string;
  tokenSymbol?: string;
  callerName: string;
  chain: string;
  alertTimestamp: Date;
  entryPrice: number;
  entryMcap?: number;
  athPrice: number;
  athMcap?: number;
  athMultiple: number; // 1.2x, 20x, 50x etc.
  timeToAthMinutes: number;
  atlPrice: number; // All-time low from alert until ATH
  atlTimestamp?: Date; // Timestamp when ATL was hit
  atlMultiple: number; // Entry price / ATL price (how much it dropped)
  currentPrice?: number;
  currentMultiple?: number;
  // Period-based metrics (optional, calculated on demand)
  periodMetrics?: PeriodMetrics;
}

/**
 * Period-based metrics for re-entry strategy analysis
 */
export interface PeriodMetrics {
  // Period ATH (highest price in the analysis period)
  periodAthPrice: number;
  periodAthTimestamp: Date;
  periodAthMultiple: number;
  timeToPeriodAthMinutes: number;

  // Period ATL (lowest price before period ATH)
  periodAtlPrice: number;
  periodAtlTimestamp?: Date;
  periodAtlMultiple: number;

  // Post-ATH drawdown (lowest price after period ATH)
  postAthDrawdownPrice?: number;
  postAthDrawdownTimestamp?: Date;
  postAthDrawdownPercent?: number; // Percentage drop from ATH
  postAthDrawdownMultiple?: number; // Ratio of drawdown price to ATH

  // Re-entry opportunities detected
  reEntryOpportunities?: ReEntryOpportunity[];
}

/**
 * Re-entry opportunity after drawdown
 */
export interface ReEntryOpportunity {
  timestamp: Date;
  price: number;
  drawdownFromAth: number; // Percentage drawdown from ATH
  recoveryMultiple?: number; // Recovery multiple from re-entry price
  recoveryTimestamp?: Date;
}

/**
 * Caller statistics
 */
export interface CallerMetrics {
  callerName: string;
  totalCalls: number;
  winningCalls: number; // > 1x
  losingCalls: number; // < 1x
  winRate: number; // 0-1
  avgMultiple: number;
  bestMultiple: number;
  worstMultiple: number;
  avgTimeToAth: number;
  firstCall: Date;
  lastCall: Date;
}

/**
 * ATH distribution buckets
 */
export interface AthDistribution {
  bucket: string; // "1.0-1.5x", "1.5-2x", "2-5x", "5-10x", "10-20x", "20-50x", "50x+"
  count: number;
  percentage: number;
  avgTimeToAth: number;
}

/**
 * System performance metrics
 */
export interface SystemMetrics {
  /** Total calls in database */
  totalCalls: number;
  /** Unique callers */
  totalCallers: number;
  /** Unique tokens */
  totalTokens: number;
  /** Date range of data */
  dataRange: { start: Date; end: Date };
  /** Simulations run today */
  simulationsToday: number;
  /** Total simulations ever */
  simulationsTotal: number;
  /** Last benchmark run */
  lastBenchmark?: BenchmarkResult;
}

/**
 * Data coverage metrics
 */
export interface DataCoverage {
  /** Total tokens in cache */
  totalCached: number;
  /** Tokens with 5m data */
  has5mData: number;
  /** Tokens with 1m data */
  has1mData: number;
  /** Alerts with 52-period lookback */
  has52PeriodLookback: number;
  /** Alerts missing lookback */
  missing52PeriodLookback: number;
  /** Alerts with no cache */
  noCache: number;
}

/**
 * E2E Latency metrics
 */
export interface LatencyMetrics {
  /** Candle fetch latency (ms) */
  candleFetchMs: number;
  /** Simulation run latency (ms) */
  simulationMs: number;
  /** Total E2E latency (ms) */
  totalE2eMs: number;
  /** Candles per second throughput */
  candlesPerSec: number;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Timestamp */
  timestamp: Date;
  /** Candles fetched */
  candleCount: number;
  /** Tokens processed */
  tokenCount: number;
  /** Total time (ms) */
  totalMs: number;
  /** Avg fetch time per token (ms) */
  avgFetchMs: number;
  /** Avg simulation time per token (ms) */
  avgSimMs: number;
  /** Throughput (tokens/sec) */
  tokensPerSec: number;
  /** Is baseline (for drift detection) */
  isBaseline: boolean;
  /** Drift from baseline (%) */
  driftPercent?: number;
}

/**
 * Dashboard summary
 */
export interface DashboardSummary {
  /** System metrics */
  system: SystemMetrics;
  /** Top callers */
  topCallers: CallerMetrics[];
  /** ATH distribution */
  athDistribution: AthDistribution[];
  /** Recent calls */
  recentCalls: CallPerformance[];
  /** Latency metrics */
  latency?: LatencyMetrics;
  /** Generated at */
  generatedAt: Date;
}
