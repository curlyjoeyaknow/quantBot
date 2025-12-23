/**
 * Unit Tests for DeterministicDataReader
 *
 * Tests the deterministic reader API for snapshot-based data access.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DeterministicDataReader,
  createDeterministicReader,
} from '../../src/snapshots/deterministic-reader.js';
import type { SnapshotStorage } from '../../src/snapshots/snapshot-manager.js';
import type { DataSnapshotRef, SnapshotQueryOptions } from '../../src/snapshots/types.js';
import type { CanonicalEvent } from '../../src/canonical/schemas.js';
import { ConfigurationError } from '@quantbot/utils';

describe('DeterministicDataReader', () => {
  let mockStorage: SnapshotStorage;
  let mockEvents: CanonicalEvent[];
  let testSnapshotRef: DataSnapshotRef;

  beforeEach(() => {
    // Mock events
    mockEvents = [
      {
        asset: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        venue: 'birdeye',
        timestamp: '2024-01-15T10:00:00Z',
        eventType: 'candle',
        value: {
          open: 100,
          high: 105,
          low: 99,
          close: 103,
          volume: 1000,
          interval: '5m',
        },
        isMissing: false,
        source: 'storage',
      },
      {
        asset: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        venue: 'birdeye',
        timestamp: '2024-01-15T10:05:00Z',
        eventType: 'candle',
        value: {
          open: 103,
          high: 107,
          low: 102,
          close: 106,
          volume: 1200,
          interval: '5m',
        },
        isMissing: false,
        source: 'storage',
      },
      {
        asset: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        venue: 'telegram',
        timestamp: '2024-01-15T10:10:00Z',
        eventType: 'call',
        value: {
          side: 'buy',
          signalType: 'entry',
          signalStrength: 0.8,
        },
        isMissing: false,
        source: 'storage',
      },
    ];

    // Test snapshot reference
    testSnapshotRef = {
      snapshotId: 'test-snapshot-123',
      contentHash: 'abc123',
      createdAt: '2024-01-15T00:00:00Z',
      spec: {
        sources: ['calls', 'ohlcv'],
        from: '2024-01-15T00:00:00Z',
        to: '2024-01-15T23:59:59Z',
      },
      manifest: {
        eventCount: 3,
        eventCountsByType: { candle: 2, call: 1 },
        tokenCount: 1,
        actualFrom: '2024-01-15T10:00:00Z',
        actualTo: '2024-01-15T10:10:00Z',
        quality: {
          completeness: 100,
        },
      },
    };

    // Mock storage
    mockStorage = {
      storeSnapshotRef: vi.fn(),
      getSnapshotRef: vi.fn().mockResolvedValue(testSnapshotRef),
      storeSnapshotEvents: vi.fn(),
      querySnapshotEvents: vi.fn().mockResolvedValue(mockEvents),
    };
  });

  describe('readEvents', () => {
    it('should read events using snapshotRef', async () => {
      const reader = new DeterministicDataReader(mockStorage);
      const events = await reader.readEvents({
        snapshotRef: testSnapshotRef,
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith(testSnapshotRef.snapshotId, {});
      expect(events).toEqual(mockEvents);
    });

    it('should read events using snapshotId', async () => {
      const reader = new DeterministicDataReader(mockStorage);
      const events = await reader.readEvents({
        snapshotId: 'test-snapshot-123',
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {});
      expect(events).toEqual(mockEvents);
    });

    it('should read events using defaultSnapshotId', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');
      const events = await reader.readEvents({});

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {});
      expect(events).toEqual(mockEvents);
    });

    it('should pass query options to storage', async () => {
      const reader = new DeterministicDataReader(mockStorage);
      const options: SnapshotQueryOptions = {
        eventTypes: ['candle'],
        limit: 10,
      };

      await reader.readEvents({
        snapshotId: 'test-snapshot-123',
        queryOptions: options,
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', options);
    });

    it('should throw ConfigurationError if no snapshot specified', async () => {
      const reader = new DeterministicDataReader(mockStorage);

      await expect(reader.readEvents({})).rejects.toThrow(ConfigurationError);
      await expect(reader.readEvents({})).rejects.toThrow('No snapshot specified');
    });

    it('should prioritize snapshotRef over snapshotId', async () => {
      const reader = new DeterministicDataReader(mockStorage);
      const otherRef: DataSnapshotRef = {
        ...testSnapshotRef,
        snapshotId: 'other-snapshot',
      };

      await reader.readEvents({
        snapshotRef: otherRef,
        snapshotId: 'test-snapshot-123',
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('other-snapshot', {});
    });

    it('should prioritize snapshotId over defaultSnapshotId', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'default-snapshot');
      await reader.readEvents({
        snapshotId: 'test-snapshot-123',
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {});
    });
  });

  describe('readTokenEvents', () => {
    it('should filter events by token address', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');
      const tokenAddress = 'So11111111111111111111111111111111111111112';

      await reader.readTokenEvents(tokenAddress);

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {
        tokenAddresses: [tokenAddress],
      });
    });

    it('should merge token filter with existing query options', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');
      const tokenAddress = 'So11111111111111111111111111111111111111112';

      await reader.readTokenEvents(tokenAddress, {
        queryOptions: {
          eventTypes: ['candle'],
          limit: 10,
        },
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {
        tokenAddresses: [tokenAddress],
        eventTypes: ['candle'],
        limit: 10,
      });
    });
  });

  describe('readEventType', () => {
    it('should filter events by event type', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');

      await reader.readEventType('candle');

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {
        eventTypes: ['candle'],
      });
    });

    it('should merge event type filter with existing query options', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');

      await reader.readEventType('candle', {
        queryOptions: {
          limit: 5,
        },
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {
        eventTypes: ['candle'],
        limit: 5,
      });
    });
  });

  describe('readTimeRange', () => {
    it('should filter events by time range', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');
      const from = '2024-01-15T10:00:00Z';
      const to = '2024-01-15T10:05:00Z';

      await reader.readTimeRange(from, to);

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {
        from,
        to,
      });
    });

    it('should merge time range filter with existing query options', async () => {
      const reader = new DeterministicDataReader(mockStorage, 'test-snapshot-123');
      const from = '2024-01-15T10:00:00Z';
      const to = '2024-01-15T10:05:00Z';

      await reader.readTimeRange(from, to, {
        queryOptions: {
          eventTypes: ['candle'],
        },
      });

      expect(mockStorage.querySnapshotEvents).toHaveBeenCalledWith('test-snapshot-123', {
        from,
        to,
        eventTypes: ['candle'],
      });
    });
  });

  describe('createDeterministicReader', () => {
    it('should create reader with default snapshot ID', () => {
      const reader = createDeterministicReader(mockStorage, 'test-snapshot-123');
      expect(reader).toBeInstanceOf(DeterministicDataReader);
    });

    it('should create reader without default snapshot ID', () => {
      const reader = createDeterministicReader(mockStorage);
      expect(reader).toBeInstanceOf(DeterministicDataReader);
    });
  });
});
