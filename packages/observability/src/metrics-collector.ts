/**
 * Metrics Collector
 * ==================
 * Central collector for observability metrics with dual input modes:
 * 1. Auto-capture via EventBus subscriptions
 * 2. Manual instrumentation via timer API
 */

import { logger, eventBus } from '@quantbot/infra/utils';
import type { ApplicationEvent } from '@quantbot/infra/utils';
import { getMetricsWriter } from './influxdb-metrics-writer.js';
import type { LatencyMetric, MetricTimer, ThroughputMetric } from './types.js';

/**
 * Active timer tracking
 */
interface ActiveTimer {
  operation: string;
  component: string;
  startTime: number;
}

/**
 * Metrics Collector
 * Handles both automatic event-based and manual metric collection
 */
export class MetricsCollector {
  private writer = getMetricsWriter();
  private activeTimers: Map<string, ActiveTimer> = new Map();
  private throughputCounters: Map<string, { count: number; startTime: number }> = new Map();
  private isInitialized = false;

  /**
   * Initialize the collector and subscribe to EventBus events
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Subscribe to simulation events
    eventBus.subscribe('simulation.completed', async (event: ApplicationEvent) => {
      await this.handleSimulationEvent(event);
    });

    eventBus.subscribe('simulation.started', async (event: ApplicationEvent) => {
      await this.handleSimulationStartEvent(event);
    });

    eventBus.subscribe('simulation.failed', async (event: ApplicationEvent) => {
      await this.handleSimulationEvent(event, false);
    });

    // Subscribe to database events
    eventBus.subscribe('database.query.executed', async (event: ApplicationEvent) => {
      await this.handleDatabaseEvent(event);
    });

    // Subscribe to websocket events
    eventBus.subscribe('websocket.message.received', async (event: ApplicationEvent) => {
      await this.handleWebSocketEvent(event);
    });

    // Subscribe to service events
    eventBus.subscribe('service.started', async (event: ApplicationEvent) => {
      await this.handleServiceEvent(event);
    });

    eventBus.subscribe('service.stopped', async (event: ApplicationEvent) => {
      await this.handleServiceEvent(event);
    });

    this.isInitialized = true;
    logger.info('MetricsCollector initialized and subscribed to EventBus');
  }

  /**
   * Start a timer for manual instrumentation
   */
  startTimer(operation: string, component: string): MetricTimer {
    const timerId = `${operation}_${component}_${Date.now()}_${Math.random()}`;
    const startTime = Date.now();

    this.activeTimers.set(timerId, {
      operation,
      component,
      startTime,
    });

    return {
      stop: (options?: { success?: boolean; metadata?: Record<string, unknown> }) => {
        const timer = this.activeTimers.get(timerId);
        if (!timer) {
          logger.warn('Timer not found', { timerId, operation });
          return;
        }

        const durationMs = Date.now() - timer.startTime;
        this.activeTimers.delete(timerId);

        const metric: LatencyMetric = {
          operation: timer.operation,
          component: timer.component,
          durationMs,
          success: options?.success !== false,
          metadata: options?.metadata,
          timestamp: new Date(),
        };

        this.writer.writeLatency(metric).catch((error) => {
          logger.error('Failed to write latency metric', error, { operation, component });
        });
      },
    };
  }

  /**
   * Record a latency metric directly
   */
  async recordLatency(metric: LatencyMetric): Promise<void> {
    await this.writer.writeLatency(metric);
  }

  /**
   * Record a throughput metric
   */
  async recordThroughput(metric: ThroughputMetric): Promise<void> {
    await this.writer.writeThroughput(metric);
  }

  /**
   * Increment throughput counter for an operation
   */
  incrementThroughput(operation: string, component: string, count: number = 1): void {
    const key = `${operation}_${component}`;
    const existing = this.throughputCounters.get(key);

    if (existing) {
      existing.count += count;
    } else {
      this.throughputCounters.set(key, {
        count,
        startTime: Date.now(),
      });
    }
  }

  /**
   * Flush throughput counters (call periodically, e.g., every minute)
   */
  async flushThroughputCounters(): Promise<void> {
    const now = Date.now();
    const toFlush: ThroughputMetric[] = [];

    for (const [key, counter] of this.throughputCounters.entries()) {
      const [operation, component] = key.split('_', 2);
      const periodSeconds = Math.floor((now - counter.startTime) / 1000);

      if (periodSeconds > 0) {
        toFlush.push({
          operation,
          component,
          count: counter.count,
          periodSeconds,
          timestamp: new Date(now),
        });
      }
    }

    // Clear flushed counters
    for (const key of toFlush.map((m) => `${m.operation}_${m.component}`)) {
      this.throughputCounters.delete(key);
    }

    // Write all throughput metrics
    await Promise.all(toFlush.map((metric) => this.writer.writeThroughput(metric)));
  }

  /**
   * Get current package version
   */
  getPackageVersion(): string {
    return this.writer.getPackageVersion();
  }

  /**
   * Handle simulation completed/failed events
   */
  private async handleSimulationEvent(
    event: ApplicationEvent,
    success: boolean = true
  ): Promise<void> {
    try {
      const data = event.data as { userId?: number; mint?: string; chain?: string };
      const durationMs = Date.now() - event.metadata.timestamp;

      const metric: LatencyMetric = {
        operation: 'simulation.e2e',
        component: 'simulation',
        durationMs,
        success,
        metadata: {
          userId: data.userId,
          mint: data.mint,
          chain: data.chain,
          eventType: event.type,
        },
        timestamp: new Date(),
      };

      await this.writer.writeLatency(metric);
    } catch (error) {
      logger.error('Failed to handle simulation event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
      });
    }
  }

  /**
   * Handle simulation start events (for tracking start time)
   */
  private async handleSimulationStartEvent(event: ApplicationEvent): Promise<void> {
    // Could track start time here if needed for more accurate E2E timing
    // For now, we use the event metadata timestamp
    logger.debug('Simulation started', { eventType: event.type });
  }

  /**
   * Handle database query events
   */
  private async handleDatabaseEvent(event: ApplicationEvent): Promise<void> {
    try {
      const data = event.data as { operation?: string; duration?: number; table?: string };
      const durationMs = data.duration || Date.now() - event.metadata.timestamp;

      const metric: LatencyMetric = {
        operation: data.operation || 'database.query',
        component: 'storage',
        durationMs,
        success: true, // Database events are typically success unless error event
        metadata: {
          table: data.table,
          eventType: event.type,
        },
        timestamp: new Date(),
      };

      await this.writer.writeLatency(metric);
    } catch (error) {
      logger.error('Failed to handle database event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
      });
    }
  }

  /**
   * Handle websocket message events
   */
  private async handleWebSocketEvent(event: ApplicationEvent): Promise<void> {
    try {
      const data = event.data as { messageType?: string };
      const durationMs = 0; // WebSocket receive is typically instant, but could track processing time

      // Track throughput for websocket messages
      this.incrementThroughput('websocket.message', 'monitoring', 1);

      // Could also track latency if message processing time is available
      if (durationMs > 0) {
        const metric: LatencyMetric = {
          operation: 'websocket.message.received',
          component: 'monitoring',
          durationMs,
          success: true,
          metadata: {
            messageType: data.messageType,
            eventType: event.type,
          },
          timestamp: new Date(),
        };

        await this.writer.writeLatency(metric);
      }
    } catch (error) {
      logger.error('Failed to handle websocket event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
      });
    }
  }

  /**
   * Handle service events
   */
  private async handleServiceEvent(event: ApplicationEvent): Promise<void> {
    try {
      const data = event.data as { serviceName?: string; status?: string };
      // Service events are state changes, not operations (no duration to track)

      // Track service lifecycle events as throughput
      this.incrementThroughput('service.lifecycle', 'system', 1);

      logger.debug('Service event tracked', {
        serviceName: data.serviceName,
        status: data.status,
        eventType: event.type,
      });
    } catch (error) {
      logger.error('Failed to handle service event', {
        error: error instanceof Error ? error.message : String(error),
        eventType: event.type,
      });
    }
  }

  /**
   * Shutdown the collector
   */
  async shutdown(): Promise<void> {
    // Flush any remaining throughput counters
    await this.flushThroughputCounters();

    // Close InfluxDB connection
    await this.writer.close();

    // Clear active timers
    this.activeTimers.clear();
    this.throughputCounters.clear();

    this.isInitialized = false;
    logger.info('MetricsCollector shutdown complete');
  }
}

/**
 * Singleton instance
 */
let metricsCollectorInstance: MetricsCollector | null = null;

/**
 * Get or create the singleton MetricsCollector instance
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    metricsCollectorInstance = new MetricsCollector();
    // Auto-initialize on first access
    metricsCollectorInstance.initialize();
  }
  return metricsCollectorInstance;
}

/**
 * Convenience function to start a timer
 */
export function startTimer(operation: string, component: string): MetricTimer {
  return getMetricsCollector().startTimer(operation, component);
}

/**
 * Convenience function to record latency
 */
export async function recordLatency(metric: LatencyMetric): Promise<void> {
  await getMetricsCollector().recordLatency(metric);
}

/**
 * Convenience function to record throughput
 */
export async function recordThroughput(metric: ThroughputMetric): Promise<void> {
  await getMetricsCollector().recordThroughput(metric);
}
