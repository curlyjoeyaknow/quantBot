/**
 * Isolation Test - Litmus Test for statsStorageHandler
 *
 * This test verifies the handler can be:
 * - Imported into a REPL
 * - Called with plain objects
 * - Returns deterministic results
 *
 * If this test passes, the handler is properly decoupled from CLI infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statsStorageHandler } from '../../../../src/handlers/storage/stats-storage.js';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { SAFE_TABLES } from '../../../../src/commands/storage.js';

vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(),
  getClickHouseClient: vi.fn(),
  getStorageEngine: vi.fn(),
  ohlcvCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
  },
}));

describe('statsStorageHandler - Isolation Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      format: 'json' as const,
    };

    // Plain object context (minimal mock)
    const plainCtx = {} as any;

    // Mock Postgres
    const mockPostgresQuery = vi.fn();
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '50' }],
      });
    }

    // Mock ClickHouse
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '100' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await statsStorageHandler(plainArgs, plainCtx);

    // Deterministic result structure
    expect(result).toHaveProperty('postgres');
    expect(result).toHaveProperty('clickhouse');
    expect(typeof result.postgres).toBe('object');
    expect(typeof result.clickhouse).toBe('object');
  });

  it('returns the same result structure for the same inputs (deterministic)', async () => {
    const args1 = {
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    // Mock Postgres
    const mockPostgresQuery = vi.fn();
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    // Mock ClickHouse
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    // Setup mocks for first call
    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '25' }],
      });
    }
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '75' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    // Setup mocks for second call (same values)
    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '25' }],
      });
    }
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '75' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const ctx1 = {} as any;
    const ctx2 = {} as any;

    const result1 = await statsStorageHandler(args1, ctx1);
    const result2 = await statsStorageHandler(args2, ctx2);

    // Results should have the same structure
    expect(Object.keys(result1)).toEqual(Object.keys(result2));
    expect(result1).toHaveProperty('postgres');
    expect(result1).toHaveProperty('clickhouse');
    expect(result2).toHaveProperty('postgres');
    expect(result2).toHaveProperty('clickhouse');
  });
});
