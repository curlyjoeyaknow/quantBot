/**
 * Metrics Module Index
 * ====================
 * Simple, focused monitoring engine for QuantBot.
 */

// Types
export * from './types';

// Main engine
export {
  MetricsEngine,
  metricsEngine,
  recordCall,
  recordLatency,
  recordBenchmark,
  printDashboard,
} from './metrics-engine';

// Benchmark utilities
export {
  runBenchmark,
  runQuickBenchmark,
  measureLatency,
  printBenchmarkComparison,
  STANDARD_BENCHMARK,
} from './benchmark';
export type { BenchmarkConfig } from './benchmark';

// Data loading
export {
  loadCallsFromCallerDb,
  loadMetricsFromDatabases,
  enrichCallsWithSimResults,
  calculateAthFromCandles,
  recordSimulationResult,
  checkDataCoverage,
} from './loader';
