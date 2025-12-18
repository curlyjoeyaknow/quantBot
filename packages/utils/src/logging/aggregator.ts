/**
 * Log Aggregation and Forwarding
 * ===============================
 * Utilities for aggregating logs from multiple packages and forwarding
 * to external services (e.g., CloudWatch, Datadog, Elasticsearch).
 */

import { Logger } from '../logger';
import * as winston from 'winston';
import { ApiError } from '../index.js';

/**
 * Log aggregator configuration
 */
export interface LogAggregatorConfig {
  /** Enable log forwarding */
  enabled: boolean;
  /** Batch size for log forwarding */
  batchSize?: number;
  /** Flush interval in milliseconds */
  flushInterval?: number;
  /** External service endpoint */
  endpoint?: string;
  /** API key for external service */
  apiKey?: string;
  /** Service type */
  serviceType?: 'cloudwatch' | 'datadog' | 'elasticsearch' | 'custom';
}

/**
 * Log aggregator for collecting and forwarding logs
 */
export class LogAggregator {
  private config: LogAggregatorConfig;
  private logBuffer: Array<Record<string, unknown>> = [];
  private flushTimer?: NodeJS.Timeout;

  constructor(config: LogAggregatorConfig) {
    this.config = {
      batchSize: 100,
      flushInterval: 5000,
      ...config,
    };

    if (this.config.enabled) {
      this.startFlushTimer();
    }
  }

  /**
   * Add log to buffer
   */
  add(log: Record<string, unknown>): void {
    if (!this.config.enabled) return;

    this.logBuffer.push({
      ...log,
      timestamp: new Date().toISOString(),
    });

    if (this.logBuffer.length >= (this.config.batchSize || 100)) {
      this.flush();
    }
  }

  /**
   * Flush logs to external service
   */
  async flush(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const logsToSend = [...this.logBuffer];
    this.logBuffer = [];

    try {
      await this.sendLogs(logsToSend);
    } catch (error) {
      console.error('Failed to send logs to external service:', error);
      // Re-add to buffer if send failed (with limit to prevent memory issues)
      if (this.logBuffer.length < 1000) {
        this.logBuffer.unshift(...logsToSend);
      }
    }
  }

  /**
   * Send logs to external service
   */
  private async sendLogs(logs: Array<Record<string, unknown>>): Promise<void> {
    if (!this.config.endpoint || !this.config.apiKey) {
      return;
    }

    // Implement service-specific logic here
    switch (this.config.serviceType) {
      case 'cloudwatch':
        await this.sendToCloudWatch(logs);
        break;
      case 'datadog':
        await this.sendToDatadog(logs);
        break;
      case 'elasticsearch':
        await this.sendToElasticsearch(logs);
        break;
      case 'custom':
        await this.sendToCustomEndpoint(logs);
        break;
      default:
        console.warn('Unknown log service type:', this.config.serviceType);
    }
  }

  /**
   * Send to AWS CloudWatch
   */
  private async sendToCloudWatch(logs: Array<Record<string, unknown>>): Promise<void> {
    // Implement CloudWatch integration
    // This would use AWS SDK to send logs
    console.debug(`Would send ${logs.length} logs to CloudWatch`);
  }

  /**
   * Send to Datadog
   */
  private async sendToDatadog(logs: Array<Record<string, unknown>>): Promise<void> {
    // Implement Datadog integration
    console.debug(`Would send ${logs.length} logs to Datadog`);
  }

  /**
   * Send to Elasticsearch
   */
  private async sendToElasticsearch(logs: Array<Record<string, unknown>>): Promise<void> {
    // Implement Elasticsearch integration
    console.debug(`Would send ${logs.length} logs to Elasticsearch`);
  }

  /**
   * Send to custom endpoint
   */
  private async sendToCustomEndpoint(logs: Array<Record<string, unknown>>): Promise<void> {
    if (!this.config.endpoint) return;

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ logs }),
    });

    if (!response.ok) {
      throw new ApiError(
        `Failed to send logs: ${response.statusText}`,
        'LogAggregator',
        response.status,
        undefined,
        { url: this.config.endpoint, statusText: response.statusText }
      );
    }
  }

  /**
   * Start automatic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.config.flushInterval);
  }

  /**
   * Stop aggregator and flush remaining logs
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flush();
  }
}

/**
 * Create Winston transport for log aggregation
 */
export function createAggregatorTransport(aggregator: LogAggregator): winston.transport {
  return new winston.transports.Stream({
    stream: {
      write: (message: string) => {
        try {
          const log = JSON.parse(message) as Record<string, unknown>;
          aggregator.add(log);
        } catch {
          // Ignore parse errors
        }
      },
    } as NodeJS.WritableStream,
  });
}

/**
 * Global log aggregator instance (if configured)
 */
let globalAggregator: LogAggregator | null = null;

/**
 * Initialize global log aggregator
 */
export function initializeLogAggregator(config: LogAggregatorConfig): LogAggregator {
  if (globalAggregator) {
    globalAggregator.stop().catch(console.error);
  }

  globalAggregator = new LogAggregator(config);
  return globalAggregator;
}

/**
 * Get global log aggregator
 */
export function getLogAggregator(): LogAggregator | null {
  return globalAggregator;
}
