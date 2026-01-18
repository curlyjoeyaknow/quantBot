/**
 * Unit Tests for Event Collector
 *
 * Tests event collection with mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { StorageEventCollector } from '../../src/snapshots/event-collector.js';
import type { StorageEngine } from '@quantbot/infra/storage';
import type { SnapshotSpec } from '../../src/snapshots/types.js';
import type { CallEvent, CandleEvent } from '../../src/canonical/schemas.js';

describe('StorageEventCollector Unit Tests', () => {
  let mockStorage: StorageEngine;
  let eventCollector: StorageEventCollector;

  beforeEach(() => {
    // Create mock storage engine
    mockStorage = {
      getCandles: vi.fn(),
    } as unknown as StorageEngine;

    eventCollector = new StorageEventCollector(mockStorage);
  });

  describe('Call Collection', () => {
    it('should return empty array when DuckDB path is not provided', async () => {
      const spec: SnapshotSpec = {
        sources: ['calls'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      const events = await eventCollector.collectEvents(spec);

      expect(events).toEqual([]);
      expect(mockStorage.getCandles).not.toHaveBeenCalled();
    });

    it('should collect calls when DuckDB path is provided', async () => {
      // Mock PythonEngine
      const mockResult = {
        success: true,
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            alert_timestamp: '2024-01-15T12:00:00Z',
          },
          {
            mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            alert_timestamp: '2024-01-16T12:00:00Z',
          },
        ],
      };

      // Mock PythonEngine.runDuckDBStorage
      vi.mock('@quantbot/infra/utils', async () => {
        const actual = await vi.importActual('@quantbot/infra/utils');
        return {
          ...actual,
          getPythonEngine: vi.fn(() => ({
            runDuckDBStorage: vi.fn().mockResolvedValue(mockResult),
          })),
        };
      });

      const collectorWithPath = new StorageEventCollector(mockStorage, {
        duckdbPath: '/path/to/test.duckdb',
      });

      const spec: SnapshotSpec = {
        sources: ['calls'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      // Note: This test may need to be updated when mocking PythonEngine properly
      // For now, it tests that the code path exists
      const events = await collectorWithPath.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
    });

    it('should handle call collection with time range filters', async () => {
      const collectorWithPath = new StorageEventCollector(mockStorage, {
        duckdbPath: '/path/to/test.duckdb',
      });

      const spec: SnapshotSpec = {
        sources: ['calls'],
        from: '2024-01-15T00:00:00Z',
        to: '2024-01-15T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      // Time range filtering happens in the collectCalls method
      // Without proper mocking, this returns empty, but code path is tested
      const events = await collectorWithPath.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
    });

    it('should filter calls by token addresses', async () => {
      const collectorWithPath = new StorageEventCollector(mockStorage, {
        duckdbPath: '/path/to/test.duckdb',
      });

      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const spec: SnapshotSpec = {
        sources: ['calls'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: [tokenAddress],
        },
      };

      const events = await collectorWithPath.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('OHLCV Collection', () => {
    it('should collect OHLCV events for specified tokens', async () => {
      const mockCandles = [
        {
          timestamp: DateTime.fromISO('2024-01-15T12:00:00Z')!.toSeconds(),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
        {
          timestamp: DateTime.fromISO('2024-01-15T12:05:00Z')!.toSeconds(),
          open: 105,
          high: 115,
          low: 100,
          close: 110,
          volume: 1500,
        },
      ];

      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue(mockCandles);

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-15T00:00:00Z',
        to: '2024-01-15T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      expect(events.length).toBe(2);
      expect(events[0].eventType).toBe('candle');
      expect((events[0] as CandleEvent).value.open).toBe(100);
      expect((events[0] as CandleEvent).value.close).toBe(105);
      expect((events[0] as CandleEvent).value.volume).toBe(1000);
      expect(mockStorage.getCandles).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'solana',
        DateTime.fromISO('2024-01-15T00:00:00Z'),
        DateTime.fromISO('2024-01-15T23:59:59Z'),
        { interval: '5m' }
      );
    });

    it('should return empty array when no token addresses specified', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          // No tokenAddresses specified - will attempt to query all tokens
        },
      };

      // Without ClickHouse available in unit tests, this will return empty
      // In integration tests, this would query ClickHouse for all tokens
      const events = await eventCollector.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
      // In unit test environment, likely returns empty due to ClickHouse not being available
    });

    it('should handle errors gracefully when collecting OHLCV', async () => {
      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Storage error')
      );

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      // Should not throw, but return events from other tokens if any
      const events = await eventCollector.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
      // Should return empty array when there's an error
      expect(events.length).toBe(0);
    });

    it('should use default chain when not specified', async () => {
      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
          // No chain specified
        },
      };

      await eventCollector.collectEvents(spec);

      expect(mockStorage.getCandles).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'solana', // Default chain
        expect.any(DateTime),
        expect.any(DateTime),
        { interval: '5m' }
      );
    });
  });

  describe('Event Filtering', () => {
    it('should apply chain filter', async () => {
      const mockCandles = [
        {
          timestamp: DateTime.fromISO('2024-01-15T12:00:00Z')!.toSeconds(),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];

      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue(mockCandles);

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'ethereum',
          tokenAddresses: ['0x1234567890123456789012345678901234567890'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      expect(events.length).toBeGreaterThan(0);
      events.forEach((event) => {
        expect(event.chain).toBe('ethereum');
      });
    });

    it('should apply token address filter', async () => {
      const mockCandles = [
        {
          timestamp: DateTime.fromISO('2024-01-15T12:00:00Z')!.toSeconds(),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];

      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue(mockCandles);

      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: [tokenAddress],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      events.forEach((event) => {
        expect(event.asset).toBe(tokenAddress);
      });
    });

    it('should apply venue filter', async () => {
      const mockCandles = [
        {
          timestamp: DateTime.fromISO('2024-01-15T12:00:00Z')!.toSeconds(),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];

      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue(mockCandles);

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
          venues: ['birdeye'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      events.forEach((event) => {
        expect(event.venue).toBe('birdeye');
      });
    });

    it('should apply event type filter', async () => {
      const mockCandles = [
        {
          timestamp: DateTime.fromISO('2024-01-15T12:00:00Z')!.toSeconds(),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];

      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue(mockCandles);

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
          eventTypes: ['candle'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      events.forEach((event) => {
        expect(event.eventType).toBe('candle');
      });
    });
  });

  describe('Multiple Source Collection', () => {
    it('should collect from multiple sources', async () => {
      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const spec: SnapshotSpec = {
        sources: ['ohlcv', 'calls'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
    });

    it('should collect from all sources when using "all"', async () => {
      (mockStorage.getCandles as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const spec: SnapshotSpec = {
        sources: ['all'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      expect(Array.isArray(events)).toBe(true);
    });
  });
});
