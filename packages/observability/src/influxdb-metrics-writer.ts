/**
 * InfluxDB Metrics Writer
 * ========================
 * Handles persistence of observability metrics to InfluxDB with version tagging
 */

import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { logger } from '@quantbot/infra/utils';
import type { LatencyMetric, ThroughputMetric } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

export type { InfluxDB, WriteApi };

/**
 * Options for InfluxDBMetricsWriter constructor
 */
export interface InfluxDBMetricsWriterOptions {
  url?: string;
  token?: string;
  org?: string;
  bucket?: string;
  packageVersion?: string;
  nodeEnv?: string;
  influxDB?: InfluxDB;
  writeApi?: WriteApi;
}

/**
 * InfluxDB client for observability metrics
 */
export class InfluxDBMetricsWriter {
  private influxDB: InfluxDB;
  private writeApi: WriteApi;
  private bucket: string;
  private org: string;
  private packageVersion: string;
  private nodeEnv: string;

  constructor(options: InfluxDBMetricsWriterOptions = {}) {
    const url = options.url || process.env.INFLUX_URL || 'http://localhost:8086';
    const token = options.token || process.env.INFLUX_TOKEN || '';
    this.org = options.org || process.env.INFLUX_ORG || 'quantbot';
    this.bucket =
      options.bucket || process.env.INFLUX_OBSERVABILITY_BUCKET || 'observability_metrics';

    // Allow injection of InfluxDB instance for testing
    this.influxDB = options.influxDB || new InfluxDB({ url, token });
    this.writeApi = options.writeApi || this.influxDB.getWriteApi(this.org, this.bucket);

    // Extract package version - allow injection for testing
    this.packageVersion = options.packageVersion || this.extractPackageVersion();
    this.nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';

    // Configure default tags
    this.writeApi.useDefaultTags({
      package_version: this.packageVersion,
      node_env: this.nodeEnv,
      source: 'quantbot-observability',
    });

    logger.info('InfluxDBMetricsWriter initialized', {
      bucket: this.bucket,
      org: this.org,
      packageVersion: this.packageVersion,
      nodeEnv: this.nodeEnv,
    });
  }

  /**
   * Extract package version from root package.json
   * Tries multiple paths to handle different runtime contexts
   */
  private extractPackageVersion(): string {
    try {
      // Try multiple possible paths
      const possiblePaths = [
        // From workspace root (if running from root)
        path.join(process.cwd(), 'package.json'),
        // From packages/observability/dist (compiled)
        path.join(__dirname, '../../../package.json'),
        // From packages/observability/src (development)
        path.join(__dirname, '../../../../package.json'),
        // From packages/observability (alternative)
        path.join(__dirname, '../../../../package.json'),
      ];

      for (const packageJsonPath of possiblePaths) {
        try {
          if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const version = packageJson.version;
            if (version) {
              return version;
            }
          }
        } catch {
          // Try next path
          continue;
        }
      }

      logger.warn('Package.json not found in any expected location');
      return 'unknown';
    } catch (error) {
      logger.warn('Failed to extract package version, using "unknown"', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 'unknown';
    }
  }

  /**
   * Write latency metric to InfluxDB
   */
  async writeLatency(metric: LatencyMetric): Promise<void> {
    try {
      const point = new Point('latency')
        .tag('operation', metric.operation)
        .tag('component', metric.component)
        .tag('success', metric.success ? 'true' : 'false')
        .tag('package_version', this.packageVersion)
        .tag('node_env', this.nodeEnv)
        .floatField('duration_ms', metric.durationMs)
        .timestamp(metric.timestamp);

      // Add metadata as JSON string if provided
      if (metric.metadata) {
        point.stringField('metadata', JSON.stringify(metric.metadata));
      }

      this.writeApi.writePoint(point);
      await this.writeApi.flush();

      logger.debug('Latency metric written', {
        operation: metric.operation,
        durationMs: metric.durationMs,
        component: metric.component,
      });
    } catch (error) {
      logger.error('Failed to write latency metric', {
        error: error instanceof Error ? error.message : String(error),
        operation: metric.operation,
        component: metric.component,
      });
      // Don't throw - metrics should not break application flow
    }
  }

  /**
   * Write throughput metric to InfluxDB
   */
  async writeThroughput(metric: ThroughputMetric): Promise<void> {
    try {
      const point = new Point('throughput')
        .tag('operation', metric.operation)
        .tag('component', metric.component)
        .tag('package_version', this.packageVersion)
        .tag('node_env', this.nodeEnv)
        .intField('count', metric.count)
        .intField('period_seconds', metric.periodSeconds)
        .timestamp(metric.timestamp);

      // Add metadata as JSON string if provided
      if (metric.metadata) {
        point.stringField('metadata', JSON.stringify(metric.metadata));
      }

      this.writeApi.writePoint(point);
      await this.writeApi.flush();

      logger.debug('Throughput metric written', {
        operation: metric.operation,
        count: metric.count,
        periodSeconds: metric.periodSeconds,
        component: metric.component,
      });
    } catch (error) {
      logger.error('Failed to write throughput metric', {
        error: error instanceof Error ? error.message : String(error),
        operation: metric.operation,
        component: metric.component,
      });
      // Don't throw - metrics should not break application flow
    }
  }

  /**
   * Get current package version
   */
  getPackageVersion(): string {
    return this.packageVersion;
  }

  /**
   * Close the InfluxDB connection
   */
  async close(): Promise<void> {
    await this.writeApi.close();
    logger.info('InfluxDBMetricsWriter connection closed');
  }
}

/**
 * Singleton instance
 */
let metricsWriterInstance: InfluxDBMetricsWriter | null = null;

/**
 * Get or create the singleton InfluxDBMetricsWriter instance
 */
export function getMetricsWriter(): InfluxDBMetricsWriter {
  if (!metricsWriterInstance) {
    metricsWriterInstance = new InfluxDBMetricsWriter();
  }
  return metricsWriterInstance;
}
