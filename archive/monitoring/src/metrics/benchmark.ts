/**
 * Benchmark Runner
 * ================
 * Standard benchmark for measuring simulation engine performance.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { BenchmarkResult, LatencyMetrics } from './types';
import { metricsEngine } from './metrics-engine';

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
export const STANDARD_BENCHMARK: BenchmarkConfig = {
  name: 'Standard 5000-candle benchmark',
  tokenCount: 1,
  candlesPerToken: 5000,
  isBaseline: true,
};

/**
 * Measure E2E latency for a single operation
 */
export async function measureLatency<T>(
  operation: () => Promise<T>,
  label: string
): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await operation();
  const durationMs = Math.round(performance.now() - start);

  logger.debug(`${label} completed in ${durationMs}ms`);

  return { result, durationMs };
}

/**
 * Run simulation benchmark
 */
export async function runBenchmark(
  config: BenchmarkConfig,
  fetchCandles: () => Promise<number>, // Returns candle count
  runSimulation: () => Promise<void>
): Promise<BenchmarkResult> {
  const startTime = performance.now();

  logger.info(`Starting benchmark: ${config.name}`);

  // Fetch candles
  const fetchStart = performance.now();
  const candleCount = await fetchCandles();
  const fetchDuration = performance.now() - fetchStart;

  // Run simulation
  const simStart = performance.now();
  await runSimulation();
  const simDuration = performance.now() - simStart;

  const totalMs = Math.round(performance.now() - startTime);
  const avgFetchMs = Math.round(fetchDuration / config.tokenCount);
  const avgSimMs = Math.round(simDuration / config.tokenCount);
  const tokensPerSec = (config.tokenCount / totalMs) * 1000;

  const result: BenchmarkResult = {
    name: config.name,
    timestamp: new Date(),
    candleCount,
    tokenCount: config.tokenCount,
    totalMs,
    avgFetchMs,
    avgSimMs,
    tokensPerSec,
    isBaseline: config.isBaseline ?? false,
  };

  // Record in metrics engine
  metricsEngine.recordBenchmark(result);

  // Also record latency
  metricsEngine.recordLatency({
    candleFetchMs: avgFetchMs,
    simulationMs: avgSimMs,
    totalE2eMs: totalMs,
    candlesPerSec: candleCount / (fetchDuration / 1000),
    timestamp: new Date(),
  });

  logger.info('Benchmark complete', {
    name: config.name,
    totalMs,
    tokensPerSec: tokensPerSec.toFixed(2),
  });

  return result;
}

/**
 * Run quick benchmark with mock data (no API calls)
 */
export async function runQuickBenchmark(): Promise<BenchmarkResult> {
  const config: BenchmarkConfig = {
    name: 'Quick benchmark (mock data)',
    tokenCount: 100,
    candlesPerToken: 5000,
    isBaseline: false,
  };

  // Generate mock candles
  const mockCandles = Array.from({ length: config.candlesPerToken }, (_, i) => ({
    timestamp: Date.now() / 1000 - (config.candlesPerToken - i) * 300,
    open: 100 + Math.random() * 10,
    high: 105 + Math.random() * 10,
    low: 95 + Math.random() * 5,
    close: 100 + Math.random() * 10,
    volume: 10000 + Math.random() * 5000,
  }));

  const startTime = performance.now();

  // Simulate fetch time (just memory operations)
  const fetchStart = performance.now();
  for (let i = 0; i < config.tokenCount; i++) {
    const _ = [...mockCandles]; // Clone to simulate data processing
  }
  const fetchDuration = performance.now() - fetchStart;

  // Import simulation
  const { simulateStrategy } = await import('@quantbot/simulation');

  // Run simulations
  const simStart = performance.now();
  for (let i = 0; i < config.tokenCount; i++) {
    await simulateStrategy(mockCandles, [
      { target: 2, percent: 0.5 },
      { target: 3, percent: 0.5 },
    ]);
  }
  const simDuration = performance.now() - simStart;

  const totalMs = Math.round(performance.now() - startTime);
  const avgFetchMs = Math.round(fetchDuration / config.tokenCount);
  const avgSimMs = Math.round(simDuration / config.tokenCount);
  const tokensPerSec = (config.tokenCount / totalMs) * 1000;

  const result: BenchmarkResult = {
    name: config.name,
    timestamp: new Date(),
    candleCount: config.candlesPerToken * config.tokenCount,
    tokenCount: config.tokenCount,
    totalMs,
    avgFetchMs,
    avgSimMs,
    tokensPerSec,
    isBaseline: false,
  };

  metricsEngine.recordBenchmark(result);

  logger.info('Quick benchmark complete', {
    totalMs,
    tokensPerSec: tokensPerSec.toFixed(2),
    avgSimMs,
  });

  return result;
}

/**
 * Print benchmark comparison
 */
export function printBenchmarkComparison(
  current: BenchmarkResult,
  baseline: BenchmarkResult
): void {
  console.log('\n📊 BENCHMARK COMPARISON');
  console.log('─'.repeat(50));
  console.log(`Current:  ${current.name}`);
  console.log(`Baseline: ${baseline.name}`);
  console.log('─'.repeat(50));

  const driftTotal = ((current.totalMs - baseline.totalMs) / baseline.totalMs) * 100;
  const driftSim = ((current.avgSimMs - baseline.avgSimMs) / baseline.avgSimMs) * 100;
  const driftThroughput =
    ((current.tokensPerSec - baseline.tokensPerSec) / baseline.tokensPerSec) * 100;

  console.log(
    `Total Time:  ${baseline.totalMs}ms → ${current.totalMs}ms (${driftTotal >= 0 ? '+' : ''}${driftTotal.toFixed(1)}%)`
  );
  console.log(
    `Simulation:  ${baseline.avgSimMs}ms → ${current.avgSimMs}ms (${driftSim >= 0 ? '+' : ''}${driftSim.toFixed(1)}%)`
  );
  console.log(
    `Throughput:  ${baseline.tokensPerSec.toFixed(1)} → ${current.tokensPerSec.toFixed(1)} tok/s (${driftThroughput >= 0 ? '+' : ''}${driftThroughput.toFixed(1)}%)`
  );
  console.log('─'.repeat(50));

  if (Math.abs(driftTotal) > 10) {
    console.log(`⚠️  WARNING: Performance drift of ${driftTotal.toFixed(1)}% detected!`);
  } else {
    console.log('✅ Performance within acceptable bounds');
  }
  console.log();
}
