import { describe, it, expect, vi } from 'vitest';
import { measureLatency, runBenchmark, STANDARD_BENCHMARK } from '../../src/metrics/benchmark';
import { metricsEngine } from '../../src/metrics/metrics-engine';

vi.mock('../../src/metrics/metrics-engine', () => ({
  metricsEngine: {
    recordBenchmark: vi.fn(),
    recordLatency: vi.fn(),
  },
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Benchmark', () => {
  describe('measureLatency', () => {
    it('should measure operation latency', async () => {
      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'result';
      };

      const { result, durationMs } = await measureLatency(operation, 'test');
      expect(result).toBe('result');
      expect(durationMs).toBeGreaterThanOrEqual(10);
    });
  });

  describe('runBenchmark', () => {
    it('should run benchmark and record results', async () => {
      const fetchCandles = async () => 1000;
      const runSimulation = async () => {};

      const result = await runBenchmark(STANDARD_BENCHMARK, fetchCandles, runSimulation);
      expect(result).toBeDefined();
      expect(result.candleCount).toBe(1000);
      expect(result.tokenCount).toBe(1);
      expect(metricsEngine.recordBenchmark).toHaveBeenCalled();
    });
  });

  describe('STANDARD_BENCHMARK', () => {
    it('should have correct configuration', () => {
      expect(STANDARD_BENCHMARK.name).toBe('Standard 5000-candle benchmark');
      expect(STANDARD_BENCHMARK.candlesPerToken).toBe(5000);
      expect(STANDARD_BENCHMARK.isBaseline).toBe(true);
    });
  });
});

