/**
 * Metrics Engine
 * ==============
 * Simple, focused monitoring engine for QuantBot.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
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
 * ATH bucket definitions
 */
const ATH_BUCKETS = [
  { min: 0, max: 1, label: 'Loss (<1x)' },
  { min: 1, max: 1.5, label: '1.0-1.5x' },
  { min: 1.5, max: 2, label: '1.5-2x' },
  { min: 2, max: 5, label: '2-5x' },
  { min: 5, max: 10, label: '5-10x' },
  { min: 10, max: 20, label: '10-20x' },
  { min: 20, max: 50, label: '20-50x' },
  { min: 50, max: Infinity, label: '50x+' },
];

/**
 * In-memory metrics store (simple, no external DB needed)
 */
class MetricsStore {
  private calls: CallPerformance[] = [];
  private benchmarks: BenchmarkResult[] = [];
  private latencyHistory: LatencyMetrics[] = [];
  private simulationCount = 0;
  private baselineBenchmark: BenchmarkResult | null = null;

  addCall(call: CallPerformance): void {
    this.calls.push(call);
    // Keep only last 10000 calls in memory
    if (this.calls.length > 10000) {
      this.calls = this.calls.slice(-10000);
    }
  }

  addCalls(calls: CallPerformance[]): void {
    for (const call of calls) {
      this.addCall(call);
    }
  }

  getCalls(): CallPerformance[] {
    return this.calls;
  }

  getCallsByCallers(): Map<string, CallPerformance[]> {
    const byCallers = new Map<string, CallPerformance[]>();
    for (const call of this.calls) {
      if (!byCallers.has(call.callerName)) {
        byCallers.set(call.callerName, []);
      }
      byCallers.get(call.callerName)!.push(call);
    }
    return byCallers;
  }

  incrementSimulations(count: number = 1): void {
    this.simulationCount += count;
  }

  getSimulationCount(): number {
    return this.simulationCount;
  }

  addBenchmark(result: BenchmarkResult): void {
    this.benchmarks.push(result);
    if (result.isBaseline) {
      this.baselineBenchmark = result;
    }
    // Keep only last 100 benchmarks
    if (this.benchmarks.length > 100) {
      this.benchmarks = this.benchmarks.slice(-100);
    }
  }

  getLastBenchmark(): BenchmarkResult | undefined {
    return this.benchmarks[this.benchmarks.length - 1];
  }

  getBaselineBenchmark(): BenchmarkResult | null {
    return this.baselineBenchmark;
  }

  addLatency(metrics: LatencyMetrics): void {
    this.latencyHistory.push(metrics);
    // Keep only last 1000 latency records
    if (this.latencyHistory.length > 1000) {
      this.latencyHistory = this.latencyHistory.slice(-1000);
    }
  }

  getRecentLatency(): LatencyMetrics | undefined {
    return this.latencyHistory[this.latencyHistory.length - 1];
  }

  clear(): void {
    this.calls = [];
    this.benchmarks = [];
    this.latencyHistory = [];
    this.simulationCount = 0;
  }
}

/**
 * Global metrics store
 */
const metricsStore = new MetricsStore();

/**
 * Metrics Engine - tracks all key performance metrics
 */
export class MetricsEngine {
  private store: MetricsStore;

  constructor(store: MetricsStore = metricsStore) {
    this.store = store;
  }

  // =========================================================================
  // Call Tracking
  // =========================================================================

  /**
   * Record a call with its performance
   */
  recordCall(call: CallPerformance): void {
    this.store.addCall(call);
    logger.debug('Recorded call', {
      token: call.tokenAddress.substring(0, 20),
      caller: call.callerName,
      athMultiple: call.athMultiple.toFixed(2),
    });
  }

  /**
   * Bulk record calls
   */
  recordCalls(calls: CallPerformance[]): void {
    this.store.addCalls(calls);
    logger.info(`Recorded ${calls.length} calls`);
  }

  /**
   * Get all recorded calls
   */
  getAllCalls(): CallPerformance[] {
    return this.store.getCalls();
  }

  /**
   * Get recent calls
   */
  getRecentCalls(limit: number = 50): CallPerformance[] {
    const calls = this.store.getCalls();
    return calls.slice(-limit).reverse();
  }

  // =========================================================================
  // ATH Metrics
  // =========================================================================

  /**
   * Get ATH distribution across all calls
   */
  getAthDistribution(): AthDistribution[] {
    const calls = this.store.getCalls();
    if (calls.length === 0) {
      return ATH_BUCKETS.map((b) => ({
        bucket: b.label,
        count: 0,
        percentage: 0,
        avgTimeToAth: 0,
      }));
    }

    const distribution: AthDistribution[] = [];

    for (const bucket of ATH_BUCKETS) {
      const inBucket = calls.filter(
        (c) => c.athMultiple >= bucket.min && c.athMultiple < bucket.max
      );

      const avgTimeToAth =
        inBucket.length > 0
          ? inBucket.reduce((sum, c) => sum + c.timeToAthMinutes, 0) / inBucket.length
          : 0;

      distribution.push({
        bucket: bucket.label,
        count: inBucket.length,
        percentage: (inBucket.length / calls.length) * 100,
        avgTimeToAth: Math.round(avgTimeToAth),
      });
    }

    return distribution;
  }

  /**
   * Get best performers (highest ATH multiples)
   */
  getTopPerformers(limit: number = 10): CallPerformance[] {
    const calls = this.store.getCalls();
    return [...calls].sort((a, b) => b.athMultiple - a.athMultiple).slice(0, limit);
  }

  // =========================================================================
  // Caller Metrics
  // =========================================================================

  /**
   * Get metrics for all callers
   */
  getCallerMetrics(): CallerMetrics[] {
    const byCallers = this.store.getCallsByCallers();
    const metrics: CallerMetrics[] = [];

    for (const [callerName, calls] of byCallers) {
      if (calls.length === 0) continue;

      const sorted = [...calls].sort(
        (a, b) => a.alertTimestamp.getTime() - b.alertTimestamp.getTime()
      );

      const winning = calls.filter((c) => c.athMultiple >= 1);
      const losing = calls.filter((c) => c.athMultiple < 1);
      const multiples = calls.map((c) => c.athMultiple);

      metrics.push({
        callerName,
        totalCalls: calls.length,
        winningCalls: winning.length,
        losingCalls: losing.length,
        winRate: winning.length / calls.length,
        avgMultiple: multiples.reduce((a, b) => a + b, 0) / multiples.length,
        bestMultiple: Math.max(...multiples),
        worstMultiple: Math.min(...multiples),
        avgTimeToAth: calls.reduce((sum, c) => sum + c.timeToAthMinutes, 0) / calls.length,
        firstCall: sorted[0].alertTimestamp,
        lastCall: sorted[sorted.length - 1].alertTimestamp,
      });
    }

    // Sort by total calls desc
    return metrics.sort((a, b) => b.totalCalls - a.totalCalls);
  }

  /**
   * Get top callers by win rate
   */
  getTopCallersByWinRate(limit: number = 10, minCalls: number = 5): CallerMetrics[] {
    return this.getCallerMetrics()
      .filter((m) => m.totalCalls >= minCalls)
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, limit);
  }

  // =========================================================================
  // System Metrics
  // =========================================================================

  /**
   * Get system-wide metrics
   */
  getSystemMetrics(): SystemMetrics {
    const calls = this.store.getCalls();
    const callers = new Set(calls.map((c) => c.callerName));
    const tokens = new Set(calls.map((c) => c.tokenAddress));

    const timestamps = calls.map((c) => c.alertTimestamp.getTime());
    const start = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date();
    const end = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();

    const today = DateTime.now().startOf('day');
    const callsToday = calls.filter((c) => DateTime.fromJSDate(c.alertTimestamp) >= today).length;

    return {
      totalCalls: calls.length,
      totalCallers: callers.size,
      totalTokens: tokens.size,
      dataRange: { start, end },
      simulationsToday: callsToday,
      simulationsTotal: this.store.getSimulationCount(),
      lastBenchmark: this.store.getLastBenchmark(),
    };
  }

  // =========================================================================
  // Latency & Benchmarking
  // =========================================================================

  /**
   * Record E2E latency metrics
   */
  recordLatency(metrics: LatencyMetrics): void {
    this.store.addLatency(metrics);
    logger.debug('Recorded latency', {
      totalE2eMs: metrics.totalE2eMs,
      candleFetchMs: metrics.candleFetchMs,
      simulationMs: metrics.simulationMs,
    });
  }

  /**
   * Get most recent latency
   */
  getRecentLatency(): LatencyMetrics | undefined {
    return this.store.getRecentLatency();
  }

  /**
   * Record simulation count
   */
  recordSimulations(count: number): void {
    this.store.incrementSimulations(count);
  }

  /**
   * Record benchmark result
   */
  recordBenchmark(result: BenchmarkResult): void {
    // Calculate drift from baseline if exists
    const baseline = this.store.getBaselineBenchmark();
    if (baseline && !result.isBaseline) {
      result.driftPercent = ((result.totalMs - baseline.totalMs) / baseline.totalMs) * 100;
    }

    this.store.addBenchmark(result);

    logger.info('Benchmark recorded', {
      name: result.name,
      totalMs: result.totalMs,
      tokensPerSec: result.tokensPerSec.toFixed(2),
      driftPercent: result.driftPercent?.toFixed(1),
    });
  }

  // =========================================================================
  // Dashboard
  // =========================================================================

  /**
   * Generate full dashboard summary
   */
  getDashboardSummary(): DashboardSummary {
    return {
      system: this.getSystemMetrics(),
      topCallers: this.getCallerMetrics().slice(0, 10),
      athDistribution: this.getAthDistribution(),
      recentCalls: this.getRecentCalls(20),
      latency: this.getRecentLatency(),
      generatedAt: new Date(),
    };
  }

  /**
   * Print dashboard to console
   */
  printDashboard(): void {
    const summary = this.getDashboardSummary();

    console.log('\n' + '='.repeat(60));
    console.log('📊 QUANTBOT MONITORING DASHBOARD');
    console.log('='.repeat(60));

    // System Metrics
    console.log('\n📈 SYSTEM METRICS');
    console.log(`   Total Calls: ${summary.system.totalCalls}`);
    console.log(`   Unique Callers: ${summary.system.totalCallers}`);
    console.log(`   Unique Tokens: ${summary.system.totalTokens}`);
    console.log(`   Simulations Run: ${summary.system.simulationsTotal}`);

    // ATH Distribution
    console.log('\n🎯 ATH DISTRIBUTION');
    for (const bucket of summary.athDistribution) {
      const bar = '█'.repeat(Math.round(bucket.percentage / 2));
      console.log(
        `   ${bucket.bucket.padEnd(12)} ${bucket.count.toString().padStart(5)} (${bucket.percentage.toFixed(1).padStart(5)}%) ${bar}`
      );
    }

    // Top Callers
    if (summary.topCallers.length > 0) {
      console.log('\n👤 TOP CALLERS (by total calls)');
      for (const caller of summary.topCallers.slice(0, 5)) {
        console.log(
          `   ${caller.callerName.padEnd(20)} ${caller.totalCalls.toString().padStart(5)} calls | ` +
            `WR: ${(caller.winRate * 100).toFixed(0)}% | ` +
            `Avg: ${caller.avgMultiple.toFixed(2)}x | ` +
            `Best: ${caller.bestMultiple.toFixed(1)}x`
        );
      }
    }

    // Latency
    if (summary.latency) {
      console.log('\n⚡ LATENCY');
      console.log(`   Candle Fetch: ${summary.latency.candleFetchMs}ms`);
      console.log(`   Simulation: ${summary.latency.simulationMs}ms`);
      console.log(`   Total E2E: ${summary.latency.totalE2eMs}ms`);
    }

    // Last Benchmark
    if (summary.system.lastBenchmark) {
      const bm = summary.system.lastBenchmark;
      console.log('\n🏁 LAST BENCHMARK');
      console.log(`   ${bm.name}`);
      console.log(`   Tokens: ${bm.tokenCount} | Candles: ${bm.candleCount}`);
      console.log(`   Time: ${bm.totalMs}ms | Throughput: ${bm.tokensPerSec.toFixed(1)} tok/sec`);
      if (bm.driftPercent !== undefined) {
        const drift =
          bm.driftPercent >= 0
            ? `+${bm.driftPercent.toFixed(1)}%`
            : `${bm.driftPercent.toFixed(1)}%`;
        console.log(`   Drift from baseline: ${drift}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Generated: ${summary.generatedAt.toISOString()}`);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.store.clear();
  }
}

/**
 * Global metrics engine instance
 */
export const metricsEngine = new MetricsEngine();

/**
 * Convenience functions
 */
export function recordCall(call: CallPerformance): void {
  metricsEngine.recordCall(call);
}

export function recordLatency(metrics: LatencyMetrics): void {
  metricsEngine.recordLatency(metrics);
}

export function recordBenchmark(result: BenchmarkResult): void {
  metricsEngine.recordBenchmark(result);
}

export function printDashboard(): void {
  metricsEngine.printDashboard();
}
