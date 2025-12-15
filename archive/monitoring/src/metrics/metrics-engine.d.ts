/**
 * Metrics Engine
 * ==============
 * Simple, focused monitoring engine for QuantBot.
 */
import type {
  CallPerformance,
  CallerMetrics,
  AthDistribution,
  SystemMetrics,
  LatencyMetrics,
  BenchmarkResult,
  DashboardSummary,
} from './types';
/**
 * In-memory metrics store (simple, no external DB needed)
 */
declare class MetricsStore {
  private calls;
  private benchmarks;
  private latencyHistory;
  private simulationCount;
  private baselineBenchmark;
  addCall(call: CallPerformance): void;
  addCalls(calls: CallPerformance[]): void;
  getCalls(): CallPerformance[];
  getCallsByCallers(): Map<string, CallPerformance[]>;
  incrementSimulations(count?: number): void;
  getSimulationCount(): number;
  addBenchmark(result: BenchmarkResult): void;
  getLastBenchmark(): BenchmarkResult | undefined;
  getBaselineBenchmark(): BenchmarkResult | null;
  addLatency(metrics: LatencyMetrics): void;
  getRecentLatency(): LatencyMetrics | undefined;
  clear(): void;
}
/**
 * Metrics Engine - tracks all key performance metrics
 */
export declare class MetricsEngine {
  private store;
  constructor(store?: MetricsStore);
  /**
   * Record a call with its performance
   */
  recordCall(call: CallPerformance): void;
  /**
   * Bulk record calls
   */
  recordCalls(calls: CallPerformance[]): void;
  /**
   * Get all recorded calls
   */
  getAllCalls(): CallPerformance[];
  /**
   * Get recent calls
   */
  getRecentCalls(limit?: number): CallPerformance[];
  /**
   * Get ATH distribution across all calls
   */
  getAthDistribution(): AthDistribution[];
  /**
   * Get best performers (highest ATH multiples)
   */
  getTopPerformers(limit?: number): CallPerformance[];
  /**
   * Get metrics for all callers
   */
  getCallerMetrics(): CallerMetrics[];
  /**
   * Get top callers by win rate
   */
  getTopCallersByWinRate(limit?: number, minCalls?: number): CallerMetrics[];
  /**
   * Get system-wide metrics
   */
  getSystemMetrics(): SystemMetrics;
  /**
   * Record E2E latency metrics
   */
  recordLatency(metrics: LatencyMetrics): void;
  /**
   * Get most recent latency
   */
  getRecentLatency(): LatencyMetrics | undefined;
  /**
   * Record simulation count
   */
  recordSimulations(count: number): void;
  /**
   * Record benchmark result
   */
  recordBenchmark(result: BenchmarkResult): void;
  /**
   * Generate full dashboard summary
   */
  getDashboardSummary(): DashboardSummary;
  /**
   * Print dashboard to console
   */
  printDashboard(): void;
  /**
   * Clear all metrics
   */
  clear(): void;
}
/**
 * Global metrics engine instance
 */
export declare const metricsEngine: MetricsEngine;
/**
 * Convenience functions
 */
export declare function recordCall(call: CallPerformance): void;
export declare function recordLatency(metrics: LatencyMetrics): void;
export declare function recordBenchmark(result: BenchmarkResult): void;
export declare function printDashboard(): void;
export {};
//# sourceMappingURL=metrics-engine.d.ts.map
