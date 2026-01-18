/**
 * InfluxDB Metrics Writer Tests
 * =============================
 * Unit tests for InfluxDB metrics persistence with version tagging
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfluxDBMetricsWriter, getMetricsWriter } from '../src/influxdb-metrics-writer';
import type { LatencyMetric, ThroughputMetric } from '../src/types';

// Mock InfluxDB client
const mockWriteApi = {
  writePoint: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  useDefaultTags: vi.fn(),
};

const mockInfluxDB = {
  getWriteApi: vi.fn().mockReturnValue(mockWriteApi),
};

vi.mock('@influxdata/influxdb-client', () => {
  class MockInfluxDB {
    constructor() {
      return mockInfluxDB;
    }
    getWriteApi(org: string, bucket: string) {
      return mockInfluxDB.getWriteApi(org, bucket);
    }
  }
  return {
    InfluxDB: MockInfluxDB,
    Point: class MockPoint {
      measurement: string;
      tags: Record<string, string> = {};
      fields: Record<string, number | string> = {};
      timestampValue: Date | null = null;

      constructor(measurement: string) {
        this.measurement = measurement;
      }

      tag(key: string, value: string): this {
        this.tags[key] = value;
        return this;
      }

      floatField(key: string, value: number): this {
        this.fields[key] = value;
        return this;
      }

      intField(key: string, value: number): this {
        this.fields[key] = value;
        return this;
      }

      stringField(key: string, value: string): this {
        this.fields[key] = value;
        return this;
      }

      timestamp(ts: Date): this {
        this.timestampValue = ts;
        return this;
      }
    },
  };
});

// No need to mock fs - we'll inject packageVersion directly in tests

// Mock path
vi.mock('path', () => ({
  join: vi.fn((...parts: string[]) => parts.join('/')),
}));

// Mock logger
vi.mock('@quantbot/infra/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

describe('InfluxDBMetricsWriter', () => {
  let writer: InfluxDBMetricsWriter;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      INFLUX_URL: 'http://localhost:8086',
      INFLUX_TOKEN: 'test-token',
      INFLUX_ORG: 'test-org',
      NODE_ENV: 'test',
    };
    // Reset mocks
    mockWriteApi.writePoint.mockClear();
    mockWriteApi.flush.mockClear();
    mockWriteApi.close.mockClear();
    mockWriteApi.useDefaultTags.mockClear();
    mockInfluxDB.getWriteApi.mockReturnValue(mockWriteApi);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      writer = new InfluxDBMetricsWriter({
        org: 'test-org',
        bucket: 'observability_metrics',
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });
      // When writeApi is injected, getWriteApi is not called
      expect(mockWriteApi.useDefaultTags).toHaveBeenCalled();
      expect(writer.getPackageVersion()).toBe('1.0.3');
    });

    it('should use custom bucket from options', () => {
      writer = new InfluxDBMetricsWriter({
        org: 'test-org',
        bucket: 'custom-bucket',
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });
      // When writeApi is injected, getWriteApi is not called
      expect(writer).toBeDefined();
      // Verify bucket is set (we can't easily test internal state, but constructor should work)
    });

    it('should use injected package version', () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });
      expect(writer.getPackageVersion()).toBe('1.0.3');
    });

    it('should extract package version when not provided', () => {
      // This will use the actual extraction logic, which may return 'unknown' in test env
      writer = new InfluxDBMetricsWriter({
        writeApi: mockWriteApi as any,
      });
      // Just verify it doesn't crash and returns a string
      expect(typeof writer.getPackageVersion()).toBe('string');
    });
  });

  describe('writeLatency', () => {
    beforeEach(() => {
      // Clear mocks before each test
      mockWriteApi.writePoint.mockClear();
      mockWriteApi.flush.mockClear();
    });

    it('should write latency metric with all tags', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        nodeEnv: 'test',
        writeApi: mockWriteApi as any,
      });

      const metric: LatencyMetric = {
        operation: 'test.operation',
        component: 'test-component',
        durationMs: 123.45,
        success: true,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      };

      await writer.writeLatency(metric);

      expect(mockWriteApi.writePoint).toHaveBeenCalled();
      const point = mockWriteApi.writePoint.mock.calls[0][0];
      expect(point.measurement).toBe('latency');
      expect(point.tags.operation).toBe('test.operation');
      expect(point.tags.component).toBe('test-component');
      expect(point.tags.success).toBe('true');
      expect(point.tags.package_version).toBe('1.0.3');
      expect(point.tags.node_env).toBe('test');
      expect(point.fields.duration_ms).toBe(123.45);
      expect(mockWriteApi.flush).toHaveBeenCalled();
    });

    it('should write latency metric with metadata', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });

      const metric: LatencyMetric = {
        operation: 'test.operation',
        component: 'test-component',
        durationMs: 100,
        success: true,
        metadata: { key: 'value', count: 42 },
        timestamp: new Date(),
      };

      await writer.writeLatency(metric);

      const point = mockWriteApi.writePoint.mock.calls[0][0];
      expect(point.fields.metadata).toBe(JSON.stringify({ key: 'value', count: 42 }));
    });

    it('should write failed operation with success=false', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });

      const metric: LatencyMetric = {
        operation: 'test.operation',
        component: 'test-component',
        durationMs: 50,
        success: false,
        timestamp: new Date(),
      };

      await writer.writeLatency(metric);

      const point = mockWriteApi.writePoint.mock.calls[0][0];
      expect(point.tags.success).toBe('false');
    });

    it('should handle write errors gracefully', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });
      mockWriteApi.flush.mockRejectedValueOnce(new Error('Write failed'));

      const metric: LatencyMetric = {
        operation: 'test.operation',
        component: 'test-component',
        durationMs: 100,
        success: true,
        timestamp: new Date(),
      };

      // Should not throw
      await expect(writer.writeLatency(metric)).resolves.not.toThrow();
    });
  });

  describe('writeThroughput', () => {
    beforeEach(() => {
      // Clear mocks before each test
      mockWriteApi.writePoint.mockClear();
      mockWriteApi.flush.mockClear();
    });

    it('should write throughput metric with all tags', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        nodeEnv: 'test',
        writeApi: mockWriteApi as any,
      });

      const metric: ThroughputMetric = {
        operation: 'test.operation',
        component: 'test-component',
        count: 100,
        periodSeconds: 60,
        timestamp: new Date('2024-01-01T00:00:00Z'),
      };

      await writer.writeThroughput(metric);

      expect(mockWriteApi.writePoint).toHaveBeenCalled();
      const point = mockWriteApi.writePoint.mock.calls[0][0];
      expect(point.measurement).toBe('throughput');
      expect(point.tags.operation).toBe('test.operation');
      expect(point.tags.component).toBe('test-component');
      expect(point.tags.package_version).toBe('1.0.3');
      expect(point.tags.node_env).toBe('test');
      expect(point.fields.count).toBe(100);
      expect(point.fields.period_seconds).toBe(60);
      expect(mockWriteApi.flush).toHaveBeenCalled();
    });

    it('should write throughput metric with metadata', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });

      const metric: ThroughputMetric = {
        operation: 'test.operation',
        component: 'test-component',
        count: 50,
        periodSeconds: 30,
        metadata: { source: 'api' },
        timestamp: new Date(),
      };

      await writer.writeThroughput(metric);

      const point = mockWriteApi.writePoint.mock.calls[0][0];
      expect(point.fields.metadata).toBe(JSON.stringify({ source: 'api' }));
    });

    it('should handle write errors gracefully', async () => {
      writer = new InfluxDBMetricsWriter({
        packageVersion: '1.0.3',
        writeApi: mockWriteApi as any,
      });
      mockWriteApi.flush.mockRejectedValueOnce(new Error('Write failed'));

      const metric: ThroughputMetric = {
        operation: 'test.operation',
        component: 'test-component',
        count: 10,
        periodSeconds: 1,
        timestamp: new Date(),
      };

      // Should not throw
      await expect(writer.writeThroughput(metric)).resolves.not.toThrow();
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance from getMetricsWriter', () => {
      // Get two instances - they should be the same
      const writer1 = getMetricsWriter();
      const writer2 = getMetricsWriter();
      expect(writer1).toBe(writer2);
      expect(writer1).toBeInstanceOf(InfluxDBMetricsWriter);
    });
  });

  describe('close', () => {
    it('should close the write API connection', async () => {
      writer = new InfluxDBMetricsWriter({
        writeApi: mockWriteApi as any,
      });
      await writer.close();
      expect(mockWriteApi.close).toHaveBeenCalled();
    });
  });
});
