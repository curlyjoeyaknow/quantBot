/**
 * InfluxDB Client Tests
 * =====================
 * Unit tests for InfluxDBOHLCVClient
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { InfluxDBOHLCVClient, type OHLCVData, type TokenInfo } from '../../src/influxdb-client';

// Use vi.hoisted() to create mocks that can be used in vi.mock() factories
const { mockWriteApi, mockQueryApi, mockInfluxDB, mockInfluxDBConstructor, mockBucketsAPI } =
  vi.hoisted(() => {
    const mockWriteApi = {
      writePoint: vi.fn(),
      writePoints: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      useDefaultTags: vi.fn(),
    };

    const mockQueryApi = {
      collectRows: vi.fn(),
    };

    const mockInfluxDB = {
      getWriteApi: vi.fn(() => mockWriteApi),
      getQueryApi: vi.fn(() => mockQueryApi),
    };

    const mockInfluxDBConstructor = vi.fn(() => mockInfluxDB);

    const mockBucketsAPI = {
      getBuckets: vi.fn(),
      postBuckets: vi.fn(),
    };

    return { mockWriteApi, mockQueryApi, mockInfluxDB, mockInfluxDBConstructor, mockBucketsAPI };
  });

// Mock InfluxDB client
vi.mock('@influxdata/influxdb-client', () => ({
  InfluxDB: mockInfluxDBConstructor,
  Point: class {
    tag(name: string, value: string) {
      return this;
    }
    floatField(name: string, value: number) {
      return this;
    }
    timestamp(timestamp: number) {
      return this;
    }
  },
}));

vi.mock('@influxdata/influxdb-client-apis', () => ({
  BucketsAPI: vi.fn(() => mockBucketsAPI),
}));

describe('InfluxDBOHLCVClient', () => {
  let client: InfluxDBOHLCVClient;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INFLUX_URL = 'http://localhost:8086';
    process.env.INFLUX_TOKEN = 'test-token';
    process.env.INFLUX_ORG = 'test-org';
    process.env.INFLUX_BUCKET = 'test-bucket';
    client = new InfluxDBOHLCVClient();
  });

  describe('constructor', () => {
    it('should initialize with environment variables', () => {
      expect(mockInfluxDBConstructor).toHaveBeenCalled();
      expect(mockInfluxDB.getWriteApi).toHaveBeenCalled();
      expect(mockInfluxDB.getQueryApi).toHaveBeenCalled();
    });

    it('should use default values when env vars not set', () => {
      delete process.env.INFLUX_URL;
      delete process.env.INFLUX_TOKEN;
      delete process.env.INFLUX_ORG;
      delete process.env.INFLUX_BUCKET;

      const defaultClient = new InfluxDBOHLCVClient();
      expect(defaultClient).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should create bucket if it does not exist', async () => {
      mockBucketsAPI.getBuckets.mockResolvedValue({ buckets: [] });
      mockBucketsAPI.postBuckets.mockResolvedValue({});
      mockQueryApi.collectRows.mockResolvedValue([]);

      await client.initialize();

      expect(mockBucketsAPI.getBuckets).toHaveBeenCalled();
      expect(mockBucketsAPI.postBuckets).toHaveBeenCalled();
    });

    it('should skip bucket creation if it exists', async () => {
      mockBucketsAPI.getBuckets.mockResolvedValue({
        buckets: [{ name: 'test-bucket' }],
      });
      mockQueryApi.collectRows.mockResolvedValue([]);

      await client.initialize();

      expect(mockBucketsAPI.getBuckets).toHaveBeenCalled();
      expect(mockBucketsAPI.postBuckets).not.toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockBucketsAPI.getBuckets.mockRejectedValue(new Error('Connection error'));

      await expect(client.initialize()).rejects.toThrow('Connection error');
    });
  });

  describe('writeOHLCVData', () => {
    it('should write OHLCV data points', async () => {
      const data: OHLCVData[] = [
        {
          timestamp: 1704067200000,
          dateTime: new Date('2024-01-01'),
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 1000,
        },
      ];

      await client.writeOHLCVData('token1', 'TOKEN1', 'solana', data);

      expect(mockWriteApi.writePoints).toHaveBeenCalled();
      expect(mockWriteApi.flush).toHaveBeenCalled();
    });

    it('should handle write errors', async () => {
      mockWriteApi.flush.mockRejectedValueOnce(new Error('Write error'));

      const data: OHLCVData[] = [
        {
          timestamp: 1704067200000,
          dateTime: new Date('2024-01-01'),
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      await expect(client.writeOHLCVData('token1', 'TOKEN1', 'solana', data)).rejects.toThrow(
        'Write error'
      );
    });
  });

  describe('getOHLCVData', () => {
    it('should query OHLCV data', async () => {
      const mockRows = [
        {
          _time: '2024-01-01T00:00:00Z',
          open: '1',
          high: '2',
          low: '0.5',
          close: '1.5',
          volume: '1000',
        },
      ];

      mockQueryApi.collectRows.mockResolvedValue(mockRows);

      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const result = await client.getOHLCVData('token1', startTime, endTime, '1m');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        timestamp: expect.any(Number),
        dateTime: expect.any(Date),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 1000,
      });
    });

    it('should validate token address format', async () => {
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();

      await expect(client.getOHLCVData('invalid', startTime, endTime)).rejects.toThrow(
        'Invalid token address format'
      );
    });

    it('should validate date range', async () => {
      const invalidDate = new Date('invalid');

      await expect(
        client.getOHLCVData(
          'token1',
          invalidDate,
          DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate()
        )
      ).rejects.toThrow('Invalid date range provided');
    });

    it('should escape token address in query', async () => {
      mockQueryApi.collectRows.mockResolvedValue([]);

      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      await client.getOHLCVData('token1', startTime, endTime);

      const query = mockQueryApi.collectRows.mock.calls[0][0];
      expect(query).toContain('token_address');
    });
  });

  describe('getLatestPrice', () => {
    it('should get latest price for a token', async () => {
      mockQueryApi.collectRows.mockResolvedValue([{ _value: '1.5' }]);

      const result = await client.getLatestPrice('token1');

      expect(result).toBe(1.5);
    });

    it('should return 0 if no price found', async () => {
      mockQueryApi.collectRows.mockResolvedValue([]);

      const result = await client.getLatestPrice('token1');

      expect(result).toBe(0);
    });

    it('should validate token address', async () => {
      await expect(client.getLatestPrice('invalid')).rejects.toThrow(
        'Invalid token address format'
      );
    });
  });

  describe('hasData', () => {
    it('should return true if data exists', async () => {
      mockQueryApi.collectRows.mockResolvedValue([{ _time: '2024-01-01T00:00:00Z' }]);

      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const result = await client.hasData('token1', startTime, endTime);

      expect(result).toBe(true);
    });

    it('should return false if no data exists', async () => {
      mockQueryApi.collectRows.mockResolvedValue([]);

      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const result = await client.hasData('token1', startTime, endTime);

      expect(result).toBe(false);
    });

    it('should validate inputs', async () => {
      const invalidDate = new Date('invalid');

      await expect(
        client.hasData('token1', invalidDate, DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate())
      ).rejects.toThrow('Invalid date range provided');
    });
  });

  describe('getAvailableTokens', () => {
    it('should get list of available tokens', async () => {
      const mockRows = [
        {
          token_address: 'token1',
          token_symbol: 'TOKEN1',
          chain: 'solana',
          _value: '100',
        },
        {
          token_address: 'token2',
          token_symbol: 'TOKEN2',
          chain: 'solana',
          _value: '50',
        },
      ];

      mockQueryApi.collectRows.mockResolvedValue(mockRows);

      const result = await client.getAvailableTokens();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        address: 'token1',
        symbol: 'TOKEN1',
        chain: 'solana',
        recordCount: 100,
      });
    });

    it('should return empty array on error', async () => {
      mockQueryApi.collectRows.mockRejectedValue(new Error('Query error'));

      const result = await client.getAvailableTokens();

      expect(result).toEqual([]);
    });
  });

  describe('getTokenRecordCount', () => {
    it('should get record count for a token', async () => {
      mockQueryApi.collectRows.mockResolvedValue([{ _value: '150' }]);

      const result = await client.getTokenRecordCount('token1');

      expect(result).toBe(150);
    });

    it('should return 0 if no records found', async () => {
      mockQueryApi.collectRows.mockResolvedValue([]);

      const result = await client.getTokenRecordCount('token1');

      expect(result).toBe(0);
    });

    it('should validate token address', async () => {
      await expect(client.getTokenRecordCount('invalid')).rejects.toThrow(
        'Invalid token address format'
      );
    });
  });

  describe('close', () => {
    it('should close write API connection', async () => {
      await client.close();

      expect(mockWriteApi.close).toHaveBeenCalled();
    });
  });
});
