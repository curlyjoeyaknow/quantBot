/**
 * Monitoring Metrics Types
 * ========================
 * Core types for the monitoring engine.
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
  athMultiple: number;
  timeToAthMinutes: number;
  currentPrice?: number;
  currentMultiple?: number;
}
/**
 * Caller statistics
 */
export interface CallerMetrics {
  callerName: string;
  totalCalls: number;
  winningCalls: number;
  losingCalls: number;
  winRate: number;
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
  bucket: string;
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
  dataRange: {
    start: Date;
    end: Date;
  };
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
//# sourceMappingURL=types.d.ts.map
