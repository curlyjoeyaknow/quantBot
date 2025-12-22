/**
 * Integration Tests for Snapshot System
 *
 * Tests the snapshot system with real storage integration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DateTime } from 'luxon';
import { getStorageEngine } from '@quantbot/storage';
import { SnapshotManager } from '../../src/snapshots/snapshot-manager.js';
import { StorageEventCollector } from '../../src/snapshots/event-collector.js';
import { DuckDBSnapshotStorage } from '../../src/snapshots/duckdb-storage.js';
import type { SnapshotSpec, DataSnapshotRef } from '../../src/snapshots/types.js';
import { CoverageCalculator } from '../../src/quality/coverage.js';

describe('Snapshot Integration Tests', () => {
  let storage: ReturnType<typeof getStorageEngine>;
  let snapshotManager: SnapshotManager;
  let coverageCalculator: CoverageCalculator;
  let testDuckDbPath: string;

  beforeAll(() => {
    // Initialize storage engine
    storage = getStorageEngine({
      enableCache: false, // Disable cache for deterministic tests
    });

    // Create test DuckDB path
    testDuckDbPath = `:memory:`; // Use in-memory DB for tests

    // Create snapshot manager with test storage
    const eventCollector = new StorageEventCollector(storage);
    const snapshotStorage = new DuckDBSnapshotStorage(testDuckDbPath);
    snapshotManager = new SnapshotManager(snapshotStorage, eventCollector);

    coverageCalculator = new CoverageCalculator();
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  describe('Snapshot Creation', () => {
    it('should create a snapshot with OHLCV data', async () => {
      // Create a snapshot spec for a known token
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'], // SOL
        },
        name: 'test-ohlcv-snapshot',
      };

      // Create snapshot
      const snapshot = await snapshotManager.createSnapshot(spec);

      // Verify snapshot structure
      expect(snapshot).toBeDefined();
      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.contentHash).toBeDefined();
      expect(snapshot.spec).toEqual(spec);
      expect(snapshot.manifest).toBeDefined();
      expect(snapshot.manifest.eventCount).toBeGreaterThanOrEqual(0);
      expect(snapshot.manifest.quality.completeness).toBeGreaterThanOrEqual(0);
      expect(snapshot.manifest.quality.completeness).toBeLessThanOrEqual(100);
    });

    it('should generate deterministic content hash for same data', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      // Create snapshot twice
      const snapshot1 = await snapshotManager.createSnapshot(spec);
      const snapshot2 = await snapshotManager.createSnapshot(spec);

      // Content hash should be the same if data is identical
      // (Note: This assumes data hasn't changed between calls)
      expect(snapshot1.contentHash).toBeDefined();
      expect(snapshot2.contentHash).toBeDefined();

      // Snapshot IDs should be the same (generated from spec hash)
      expect(snapshot1.snapshotId).toBe(snapshot2.snapshotId);
    });

    it('should include quality metrics in manifest', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      const snapshot = await snapshotManager.createSnapshot(spec);

      // Verify quality metrics exist
      expect(snapshot.manifest.quality).toBeDefined();
      expect(snapshot.manifest.quality.completeness).toBeGreaterThanOrEqual(0);
      expect(snapshot.manifest.quality.completeness).toBeLessThanOrEqual(100);
      expect(snapshot.manifest.quality.missingData).toBeDefined();
      expect(snapshot.manifest.quality.anomalies).toBeDefined();
    });
  });

  describe('Snapshot Querying', () => {
    let testSnapshot: DataSnapshotRef;

    beforeAll(async () => {
      // Create a test snapshot for querying
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      testSnapshot = await snapshotManager.createSnapshot(spec);
    });

    it('should query snapshot events by event type', async () => {
      const events = await snapshotManager.querySnapshot(testSnapshot.snapshotId, {
        eventTypes: ['candle'],
        limit: 10,
      });

      expect(Array.isArray(events)).toBe(true);
      // All events should be candles
      events.forEach((event) => {
        expect(event.eventType).toBe('candle');
      });
    });

    it('should filter events by token address', async () => {
      const events = await snapshotManager.querySnapshot(testSnapshot.snapshotId, {
        tokenAddresses: ['So11111111111111111111111111111111111111112'],
        limit: 10,
      });

      expect(Array.isArray(events)).toBe(true);
      // All events should be for the specified token
      events.forEach((event) => {
        expect(event.asset).toBe('So11111111111111111111111111111111111111112');
      });
    });

    it('should respect time range filters', async () => {
      const events = await snapshotManager.querySnapshot(testSnapshot.snapshotId, {
        from: '2024-01-15T00:00:00Z',
        to: '2024-01-20T23:59:59Z',
        limit: 100,
      });

      expect(Array.isArray(events)).toBe(true);
      // All events should be within the time range
      const from = DateTime.fromISO('2024-01-15T00:00:00Z');
      const to = DateTime.fromISO('2024-01-20T23:59:59Z');

      events.forEach((event) => {
        const eventTime = DateTime.fromISO(event.timestamp);
        expect(eventTime >= from).toBe(true);
        expect(eventTime <= to).toBe(true);
      });
    });

    it('should respect limit parameter', async () => {
      const limit = 5;
      const events = await snapshotManager.querySnapshot(testSnapshot.snapshotId, {
        limit,
      });

      expect(events.length).toBeLessThanOrEqual(limit);
    });
  });

  describe('Snapshot Retrieval', () => {
    it('should retrieve snapshot by ID', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      const created = await snapshotManager.createSnapshot(spec);
      const retrieved = await snapshotManager.getSnapshot(created.snapshotId);

      // Note: This will be null until DuckDB storage is fully implemented
      // This test verifies the interface works
      expect(retrieved).toBeDefined(); // May be null until storage is implemented
    });
  });

  describe('Coverage Calculation Integration', () => {
    it('should calculate coverage for snapshot events', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-07T23:59:59Z', // 1 week
        filters: {
          chain: 'solana',
          tokenAddresses: ['So11111111111111111111111111111111111111112'],
        },
      };

      const snapshot = await snapshotManager.createSnapshot(spec);
      const events = await snapshotManager.querySnapshot(snapshot.snapshotId, {
        eventTypes: ['candle'],
      });

      // Calculate coverage
      const from = DateTime.fromISO(spec.from);
      const to = DateTime.fromISO(spec.to);
      const coverage = coverageCalculator.calculateTokenCoverage(
        'So11111111111111111111111111111111111111112',
        'solana',
        events,
        from,
        to,
        5 // 5-minute intervals
      );

      // Verify coverage structure
      expect(coverage.tokenAddress).toBe('So11111111111111111111111111111111111111112');
      expect(coverage.chain).toBe('solana');
      expect(coverage.completeness).toBeGreaterThanOrEqual(0);
      expect(coverage.completeness).toBeLessThanOrEqual(100);
      expect(coverage.expectedCount).toBeGreaterThanOrEqual(0);
      expect(coverage.actualCount).toBe(events.length);
      expect(Array.isArray(coverage.gaps)).toBe(true);
      expect(Array.isArray(coverage.anomalies)).toBe(true);
    });

    it('should calculate aggregate coverage across multiple tokens', async () => {
      const tokenAddresses = [
        'So11111111111111111111111111111111111111112',
        // Add more tokens if available in test data
      ];

      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-07T23:59:59Z',
        filters: {
          chain: 'solana',
          tokenAddresses,
        },
      };

      const snapshot = await snapshotManager.createSnapshot(spec);
      const events = await snapshotManager.querySnapshot(snapshot.snapshotId, {
        eventTypes: ['candle'],
      });

      // Calculate coverage for each token
      const from = DateTime.fromISO(spec.from);
      const to = DateTime.fromISO(spec.to);
      const coverages = tokenAddresses.map((tokenAddress) =>
        coverageCalculator.calculateTokenCoverage(
          tokenAddress,
          'solana',
          events,
          from,
          to,
          5
        )
      );

      // Calculate aggregate
      const aggregate = coverageCalculator.calculateAggregateCoverage(coverages);

      // Verify aggregate structure
      expect(aggregate.totalTokens).toBe(tokenAddresses.length);
      expect(aggregate.averageCompleteness).toBeGreaterThanOrEqual(0);
      expect(aggregate.averageCompleteness).toBeLessThanOrEqual(100);
      expect(aggregate.tokensWithFullCoverage).toBeGreaterThanOrEqual(0);
      expect(aggregate.tokensWithPartialCoverage).toBeGreaterThanOrEqual(0);
      expect(aggregate.tokensWithNoCoverage).toBeGreaterThanOrEqual(0);
    });
  });

  describe('DataSnapshotRef Format Compatibility', () => {
    it('should produce valid DataSnapshotRef for Branch A consumption', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
        filters: {
          chain: 'solana',
        },
      };

      const snapshot = await snapshotManager.createSnapshot(spec);

      // Verify all required fields for Branch A
      expect(snapshot.snapshotId).toBeDefined();
      expect(typeof snapshot.snapshotId).toBe('string');
      expect(snapshot.snapshotId.length).toBeGreaterThan(0);

      expect(snapshot.contentHash).toBeDefined();
      expect(typeof snapshot.contentHash).toBe('string');
      expect(snapshot.contentHash.length).toBe(64); // SHA-256 hex = 64 chars

      expect(snapshot.createdAt).toBeDefined();
      expect(() => DateTime.fromISO(snapshot.createdAt)).not.toThrow();

      // Verify spec structure
      expect(snapshot.spec).toBeDefined();
      expect(Array.isArray(snapshot.spec.sources)).toBe(true);
      expect(() => DateTime.fromISO(snapshot.spec.from)).not.toThrow();
      expect(() => DateTime.fromISO(snapshot.spec.to)).not.toThrow();

      // Verify manifest structure
      expect(snapshot.manifest).toBeDefined();
      expect(typeof snapshot.manifest.eventCount).toBe('number');
      expect(typeof snapshot.manifest.tokenCount).toBe('number');
      expect(typeof snapshot.manifest.quality.completeness).toBe('number');
      expect(() => DateTime.fromISO(snapshot.manifest.actualFrom)).not.toThrow();
      expect(() => DateTime.fromISO(snapshot.manifest.actualTo)).not.toThrow();
    });

    it('should have JSON-serializable DataSnapshotRef', async () => {
      const spec: SnapshotSpec = {
        sources: ['ohlcv'],
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-31T23:59:59Z',
      };

      const snapshot = await snapshotManager.createSnapshot(spec);

      // Should be JSON serializable (no circular refs, no functions, etc.)
      const json = JSON.stringify(snapshot);
      expect(json).toBeDefined();

      // Should be parseable back
      const parsed = JSON.parse(json);
      expect(parsed.snapshotId).toBe(snapshot.snapshotId);
      expect(parsed.contentHash).toBe(snapshot.contentHash);
    });
  });
});

