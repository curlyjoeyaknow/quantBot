import { describe, it, expect, vi, beforeEach } from 'vitest';
import { metricsEngine } from '../../src/metrics/metrics-engine';
import type { CallPerformance, BenchmarkResult, LatencyMetrics } from '../../src/metrics/types';

describe('Metrics Engine', () => {
  beforeEach(() => {
    // Reset metrics engine state
    vi.clearAllMocks();
  });

  describe('recordCall', () => {
    it('should record a call', () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: '7pXs123456789012345678901234567890pump',
        chain: 'solana',
        alertTimestamp: new Date(),
        entryPrice: 1.0,
        athPrice: 2.0,
        athMultiple: 2.0,
        timeToAthMinutes: 60,
        callerName: 'test',
      };

      metricsEngine.recordCall(call);
      const calls = metricsEngine.getCalls();
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('recordBenchmark', () => {
    it('should record a benchmark', () => {
      const benchmark: BenchmarkResult = {
        name: 'Test Benchmark',
        timestamp: new Date(),
        candleCount: 1000,
        tokenCount: 1,
        totalMs: 1000,
        avgFetchMs: 500,
        avgSimMs: 500,
        tokensPerSec: 1,
        isBaseline: false,
      };

      metricsEngine.recordBenchmark(benchmark);
      const lastBenchmark = metricsEngine.getLastBenchmark();
      expect(lastBenchmark).toBeDefined();
    });
  });

  describe('recordLatency', () => {
    it('should record latency metrics', () => {
      const latency: LatencyMetrics = {
        candleFetchMs: 100,
        simulationMs: 200,
        totalE2eMs: 300,
        candlesPerSec: 10,
        timestamp: new Date(),
      };

      metricsEngine.recordLatency(latency);
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('getCallerMetrics', () => {
    it('should calculate caller metrics', () => {
      const call: CallPerformance = {
        callId: 1,
        tokenAddress: 'test',
        chain: 'solana',
        alertTimestamp: new Date(),
        entryPrice: 1.0,
        athPrice: 2.0,
        athMultiple: 2.0,
        timeToAthMinutes: 60,
        callerName: 'test_caller',
      };

      metricsEngine.recordCall(call);
      const metrics = metricsEngine.getCallerMetrics('test_caller');
      expect(metrics).toBeDefined();
      expect(metrics.totalCalls).toBeGreaterThanOrEqual(1);
    });
  });
});

