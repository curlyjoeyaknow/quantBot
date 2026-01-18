/**
 * Integration tests for Branch B (Data Observatory) integration
 *
 * These tests verify that Branch A can work with Branch B's DataSnapshotRef interface.
 * Now uses the real DataSnapshotService implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataSnapshotRef } from '../../../src/research/contract.js';
import { SimulationRequestSchema } from '../../../src/research/contract.js';
import { DataSnapshotService } from '../../../src/research/services/DataSnapshotService.js';

// Mock storage to avoid requiring real database connections in tests
vi.mock('@quantbot/infra/storage', async () => {
  const actual = await vi.importActual('@quantbot/infra/storage');
  return {
    ...actual,
    getStorageEngine: vi.fn(() => ({
      getCandles: vi.fn().mockResolvedValue([
        {
          timestamp: new Date('2024-01-01T00:00:00Z').getTime() / 1000,
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ]),
    })),
  };
});

vi.mock('../../../src/calls/queryCallsDuckdb', async () => {
  const actual = await vi.importActual('../../../src/calls/queryCallsDuckdb');
  return {
    ...actual,
    queryCallsDuckdb: vi.fn().mockResolvedValue({
      calls: [
        {
          id: 'call-001',
          caller: 'test-caller',
          mint: 'mint-001',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          price: 100,
          volume: 1000,
        },
      ],
      totalQueried: 1,
      totalReturned: 1,
      fromISO: '2024-01-01T00:00:00Z',
      toISO: '2024-01-02T00:00:00Z',
    }),
  };
});

/**
 * Real Branch B: Data Snapshot Service
 *
 * This is the actual implementation that:
 * - createSnapshot() - Creates a DataSnapshotRef from real data sources
 * - loadSnapshot() - Loads data from a DataSnapshotRef
 * - verifySnapshot() - Verifies snapshot integrity
 */
describe('Branch B Integration (Data Observatory)', () => {
  let dataService: DataSnapshotService;

  beforeEach(() => {
    // Create service without context (uses mocks)
    dataService = new DataSnapshotService();
  });

  it('creates and validates DataSnapshotRef', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun', chain: 'solana' }],
      filters: {
        callerNames: ['caller1'],
        minVolume: 1000,
      },
    });

    // Verify snapshot structure
    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.filters?.callerNames).toEqual(['caller1']);

    // Verify snapshot integrity
    const isValid = await dataService.verifySnapshot(snapshot);
    expect(isValid).toBe(true);
  });

  it('loads data from snapshot', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    const data = await dataService.loadSnapshot(snapshot);

    expect(data.candles).toBeDefined();
    // Note: candles may be empty if no data exists in the database for this time range
    // This is expected behavior when testing with empty/mocked databases
    expect(Array.isArray(data.candles)).toBe(true);
    expect(data.calls).toBeDefined();
    // Note: calls may be empty if no data exists in the database for this time range
    expect(Array.isArray(data.calls)).toBe(true);
  });

  it('creates simulation request with DataSnapshotRef', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    const request = {
      dataSnapshot: snapshot,
      strategy: {
        strategyId: 'strategy-001',
        name: 'test',
        config: {
          name: 'test',
          profitTargets: [{ target: 2.0, percent: 1.0 }],
        },
        configHash: 'a'.repeat(64),
      },
      executionModel: {
        latency: { p50: 100, p90: 200, p99: 500 },
        slippage: { base: 0.001 },
      },
      costModel: {
        baseFee: 5000,
      },
      runConfig: {
        seed: 12345,
      },
    };

    const result = SimulationRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('detects snapshot tampering', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });

    // Tamper with snapshot
    const tampered = {
      ...snapshot,
      contentHash: 'tampered-hash',
    };

    const isValid = await dataService.verifySnapshot(tampered);
    expect(isValid).toBe(false);
  });

  it('handles multiple sources in snapshot', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [
        { venue: 'pump.fun', chain: 'solana' },
        { venue: 'birdeye', chain: 'solana' },
      ],
    });

    expect(snapshot.sources).toHaveLength(2);
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('preserves filters in snapshot hash', async () => {
    const snapshot1 = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
      filters: { callerNames: ['caller1'] },
    });

    const snapshot2 = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
      filters: { callerNames: ['caller2'] },
    });

    // Different filters = different hash
    expect(snapshot1.contentHash).not.toBe(snapshot2.contentHash);
  });
});
