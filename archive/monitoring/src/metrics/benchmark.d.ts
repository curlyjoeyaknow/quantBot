/**
 * Benchmark Runner
 * ================
 * Standard benchmark for measuring simulation engine performance.
 */
import type { BenchmarkResult } from './types';
/**
 * Benchmark configuration
 */
export interface BenchmarkConfig {
  /** Benchmark name */
  name: string;
  /** Number of tokens to process */
  tokenCount: number;
  /** Candles per token to fetch */
  candlesPerToken: number;
  /** Set as baseline for drift detection */
  isBaseline?: boolean;
}
/**
 * Standard benchmark: 5000 candles for baseline grounding
 */
export declare const STANDARD_BENCHMARK: BenchmarkConfig;
/**
 * Measure E2E latency for a single operation
 */
export declare function measureLatency<T>(
  operation: () => Promise<T>,
  label: string
): Promise<{
  result: T;
  durationMs: number;
}>;
/**
 * Run simulation benchmark
 */
export declare function runBenchmark(
  config: BenchmarkConfig,
  fetchCandles: () => Promise<number>, // Returns candle count
  runSimulation: () => Promise<void>
): Promise<BenchmarkResult>;
/**
 * Run quick benchmark with mock data (no API calls)
 */
export declare function runQuickBenchmark(): Promise<BenchmarkResult>;
/**
 * Print benchmark comparison
 */
export declare function printBenchmarkComparison(
  current: BenchmarkResult,
  baseline: BenchmarkResult
): void;
//# sourceMappingURL=benchmark.d.ts.map
