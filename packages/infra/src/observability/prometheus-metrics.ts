/**
 * Prometheus Metrics Service
 * ===========================
 * Live counters and alerting for API calls, credits, and system metrics.
 * Simple, fast, and cheap metrics collection.
 */

import { logger } from '../utils/index.js';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics configuration
 */
export interface PrometheusMetricsConfig {
  /**
   * Enable default Node.js metrics (CPU, memory, etc.)
   */
  enableDefaultMetrics?: boolean;
  /**
   * Default metrics collection interval in seconds
   */
  defaultMetricsInterval?: number;
}

/**
 * Prometheus Metrics Service
 */
export class PrometheusMetricsService {
  private registry: Registry;
  private apiCallCounter: Counter<string>;
  private apiCallErrorsCounter: Counter<string>;
  private apiCreditsCounter: Counter<string>;
  private apiLatencyHistogram: Histogram<string>;
  private circuitBreakerGauge: Gauge<string>;
  private creditsSpentGauge: Gauge<string>;

  constructor(config: PrometheusMetricsConfig = {}) {
    this.registry = new Registry();

    // API call counter
    this.apiCallCounter = new Counter({
      name: 'quantbot_api_calls_total',
      help: 'Total number of API calls',
      labelNames: ['api_name', 'endpoint', 'status'],
      registers: [this.registry],
    });

    // API call errors counter
    this.apiCallErrorsCounter = new Counter({
      name: 'quantbot_api_errors_total',
      help: 'Total number of API call errors',
      labelNames: ['api_name', 'endpoint', 'error_type'],
      registers: [this.registry],
    });

    // API credits counter
    this.apiCreditsCounter = new Counter({
      name: 'quantbot_api_credits_total',
      help: 'Total credits spent on API calls',
      labelNames: ['api_name'],
      registers: [this.registry],
    });

    // API latency histogram
    this.apiLatencyHistogram = new Histogram({
      name: 'quantbot_api_latency_seconds',
      help: 'API call latency in seconds',
      labelNames: ['api_name', 'endpoint'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
      registers: [this.registry],
    });

    // Circuit breaker gauge
    this.circuitBreakerGauge = new Gauge({
      name: 'quantbot_circuit_breaker_tripped',
      help: 'Circuit breaker status (1 = tripped, 0 = normal)',
      labelNames: ['api_name'],
      registers: [this.registry],
    });

    // Credits spent gauge (last N minutes)
    this.creditsSpentGauge = new Gauge({
      name: 'quantbot_credits_spent_window',
      help: 'Credits spent in the last time window',
      labelNames: ['api_name', 'window_minutes'],
      registers: [this.registry],
    });

    // Enable default metrics if requested
    if (config.enableDefaultMetrics !== false) {
      collectDefaultMetrics({
        register: this.registry,
        prefix: 'quantbot_',
      });
      // Note: interval is set via setInterval in collectDefaultMetrics internally
      // The interval option may not be available in all prom-client versions
    }

    logger.info('Prometheus metrics service initialized');
  }

  /**
   * Record an API call
   */
  recordApiCall(
    apiName: string,
    endpoint: string,
    statusCode: number,
    latencyMs: number,
    credits: number
  ): void {
    const status = statusCode >= 200 && statusCode < 300 ? 'success' : 'error';
    const latencySeconds = latencyMs / 1000;

    this.apiCallCounter.inc({ api_name: apiName, endpoint, status });
    this.apiCreditsCounter.inc({ api_name: apiName }, credits);
    this.apiLatencyHistogram.observe({ api_name: apiName, endpoint }, latencySeconds);

    if (status === 'error') {
      this.apiCallErrorsCounter.inc({
        api_name: apiName,
        endpoint,
        error_type: `http_${statusCode}`,
      });
    }
  }

  /**
   * Record an API error
   */
  recordApiError(apiName: string, endpoint: string, errorType: string): void {
    this.apiCallErrorsCounter.inc({
      api_name: apiName,
      endpoint,
      error_type: errorType,
    });
  }

  /**
   * Update circuit breaker status
   */
  setCircuitBreakerStatus(apiName: string, tripped: boolean): void {
    this.circuitBreakerGauge.set({ api_name: apiName }, tripped ? 1 : 0);
  }

  /**
   * Update credits spent in time window
   */
  setCreditsSpent(apiName: string, windowMinutes: number, credits: number): void {
    this.creditsSpentGauge.set(
      { api_name: apiName, window_minutes: String(windowMinutes) },
      credits
    );
  }

  /**
   * Get metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Get registry for advanced usage
   */
  getRegistry(): Registry {
    return this.registry;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.registry.resetMetrics();
  }
}

/**
 * Singleton instance
 */
let metricsInstance: PrometheusMetricsService | null = null;

/**
 * Get or create the singleton PrometheusMetricsService instance
 */
export function getPrometheusMetrics(config?: PrometheusMetricsConfig): PrometheusMetricsService {
  if (!metricsInstance) {
    metricsInstance = new PrometheusMetricsService(config);
  }
  return metricsInstance;
}
