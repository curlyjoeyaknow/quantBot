/**
 * Integration Tests for Event Collection
 *
 * Tests event collection from storage layer.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { DateTime } from 'luxon';
import { getStorageEngine } from '@quantbot/infra/storage';
import { StorageEventCollector } from '../../src/snapshots/event-collector.js';
import type { SnapshotSpec } from '../../src/snapshots/types.js';
import type { CanonicalEvent } from '../../src/canonical/schemas.js';

describe('Event Collection Integration Tests', () => {
  let storage: ReturnType<typeof getStorageEngine>;
  let eventCollector: StorageEventCollector;

  beforeAll(() => {
    storage = getStorageEngine({
      enableCache: false,
    });
    // Create event collector without DuckDB path for call collection
    // (will only test OHLCV collection in integration tests)
    eventCollector = new StorageEventCollector(storage);
  });

  describe('OHLCV Event Collection', () => {
    it('should collect OHLCV events from storage', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // Should return an array
      expect(Array.isArray(events)).toBe(true);

      // If events exist, verify structure
      if (events.length > 0) {
        const firstEvent = events[0];
        expect(firstEvent.asset).toBe('So11111111111111111111111111111111111111112');
        expect(firstEvent.chain).toBe('solana');
        expect(firstEvent.eventType).toBe('candle');
        expect(firstEvent.venue).toBeDefined();
        expect(firstEvent.timestamp).toBeDefined();
        expect(() => DateTime.fromISO(firstEvent.timestamp)).not.toThrow();

        // Verify candle-specific value structure
        if (firstEvent.eventType === 'candle') {
          expect(firstEvent.value).toBeDefined();
          expect(typeof (firstEvent.value as any).open).toBe('number');
          expect(typeof (firstEvent.value as any).close).toBe('number');
          expect(typeof (firstEvent.value as any).volume).toBe('number');
        }
      }
    });

    it('should filter events by chain', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // All events should be for solana chain
      events.forEach((event) => {
        expect(event.chain).toBe('solana');
      });
    });

    it('should filter events by token addresses', async () => {
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

      // All events should be for the specified token
      events.forEach((event) => {
        expect(event.asset).toBe(tokenAddress);
      });
    });

    it('should handle empty result gracefully', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2099-01-01T00:00:00Z', // Future date, no data
        to: '2099-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // Should return empty array, not throw
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBe(0);
    });
  });

  describe('Multiple Source Collection', () => {
    it('should collect from multiple sources', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv', 'calls'], // calls will return empty until implemented
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // Should return events from all sources
      expect(Array.isArray(events)).toBe(true);

      // Events should be valid canonical events
      events.forEach((event) => {
        expect(event.asset).toBeDefined();
        expect(event.chain).toBeDefined();
        expect(event.eventType).toBeDefined();
        expect(event.timestamp).toBeDefined();
      });
    });

    it('should collect from all sources when using "all"', async () => {
      const spec: SnapshotSpec = {
        sources: ['all'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // Should attempt to collect from all sources
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe('Event Filtering', () => {
    it('should apply venue filters', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          venues: ['birdeye'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // All events should be from specified venues
      events.forEach((event) => {
        expect(spec.filters?.venues).toContain(event.venue);
      });
    });

    it('should apply event type filters', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          eventTypes: ['candle'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // All events should be of specified types
      events.forEach((event) => {
        expect(spec.filters?.eventTypes).toContain(event.eventType);
      });
    });
  });

  describe('Canonical Event Structure', () => {
    it('should produce valid canonical events', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const events = await eventCollector.collectEvents(spec);

      // Validate each event structure
      events.forEach((event) => {
        // Required fields
        expect(event.asset).toBeDefined();
        expect(event.asset.length).toBeGreaterThanOrEqual(32);
        expect(event.asset.length).toBeLessThanOrEqual(44);

        expect(event.chain).toBeDefined();
        expect(['solana', 'ethereum', 'bsc', 'base', 'monad', 'evm']).toContain(event.chain);

        expect(event.venue).toBeDefined();
        expect(event.timestamp).toBeDefined();
        expect(() => DateTime.fromISO(event.timestamp)).not.toThrow();

        expect(event.eventType).toBeDefined();
        expect([
          'call',
          'trade',
          'candle',
          'metadata',
          'signal',
          'price_update',
          'volume_update',
        ]).toContain(event.eventType);

        expect(event.value).toBeDefined();
        expect(typeof event.isMissing).toBe('boolean');
      });
    });

    it('should preserve token address case', async () => {
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

      // Addresses should preserve exact case
      events.forEach((event) => {
        expect(event.asset).toBe(tokenAddress);
      });
    });
  });
});
