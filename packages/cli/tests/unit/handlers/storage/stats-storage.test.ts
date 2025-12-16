/**
 * Unit tests for statsStorageHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statsStorageHandler } from '../../../../src/handlers/storage/stats-storage.js';
import { getPostgresPool, getClickHouseClient } from '@quantbot/storage';
import { SAFE_TABLES } from '../../../../src/commands/storage.js';

// Mock storage clients
vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(),
  getClickHouseClient: vi.fn(),
}));

describe('statsStorageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stats from both Postgres and ClickHouse', async () => {
    // Mock Postgres pool
    const mockPostgresQuery = vi.fn();
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    // Mock ClickHouse client
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    // Setup Postgres mocks
    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '100' }],
      });
    }

    // Setup ClickHouse mocks
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '200' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const fakeCtx = {} as any;
    const args = {
      format: 'json' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // Verify Postgres stats
    expect(result.postgres).toBeDefined();
    expect(typeof result.postgres).toBe('object');
    for (const table of SAFE_TABLES.postgres) {
      expect((result.postgres as Record<string, number>)[table]).toBe(100);
    }

    // Verify ClickHouse stats
    expect(result.clickhouse).toBeDefined();
    expect(typeof result.clickhouse).toBe('object');
    for (const table of SAFE_TABLES.clickhouse) {
      expect((result.clickhouse as Record<string, number>)[table]).toBe(200);
    }
  });

  it('handles Postgres errors gracefully', async () => {
    const mockPostgresQuery = vi.fn().mockRejectedValue(new Error('Connection failed'));
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    // Setup ClickHouse mocks
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '50' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const fakeCtx = {} as any;
    const args = {
      format: 'table' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // Postgres should have error
    expect(result.postgres).toBeDefined();
    expect((result.postgres as { error: string }).error).toBe('Connection failed');

    // ClickHouse should still work
    expect(result.clickhouse).toBeDefined();
    expect(typeof result.clickhouse).toBe('object');
  });

  it('handles ClickHouse errors gracefully', async () => {
    const mockPostgresQuery = vi.fn();
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    // Setup Postgres mocks
    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '75' }],
      });
    }

    const mockClickHouseQuery = vi.fn().mockRejectedValue(new Error('ClickHouse unavailable'));
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    const fakeCtx = {} as any;
    const args = {
      format: 'json' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // Postgres should work
    expect(result.postgres).toBeDefined();
    expect(typeof result.postgres).toBe('object');

    // ClickHouse should have error
    expect(result.clickhouse).toBeDefined();
    expect((result.clickhouse as { error: string }).error).toBe('ClickHouse unavailable');
  });

  it('handles missing format parameter', async () => {
    const mockPostgresQuery = vi.fn();
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    // Setup mocks
    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '0' }],
      });
    }

    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '0' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const fakeCtx = {} as any;
    const args = {}; // No format

    const result = await statsStorageHandler(args, fakeCtx);

    expect(result.postgres).toBeDefined();
    expect(result.clickhouse).toBeDefined();
  });

  it('returns empty counts when tables have no data', async () => {
    const mockPostgresQuery = vi.fn();
    const mockPostgresPool = {
      query: mockPostgresQuery,
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPostgresPool as any);

    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };
    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);

    // Setup Postgres mocks with empty results
    for (const table of SAFE_TABLES.postgres) {
      mockPostgresQuery.mockResolvedValueOnce({
        rows: [{ count: '0' }],
      });
    }

    // Setup ClickHouse mocks with empty results
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '0' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const fakeCtx = {} as any;
    const args = {
      format: 'json' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // All counts should be 0
    for (const table of SAFE_TABLES.postgres) {
      expect((result.postgres as Record<string, number>)[table]).toBe(0);
    }
    for (const table of SAFE_TABLES.clickhouse) {
      expect((result.clickhouse as Record<string, number>)[table]).toBe(0);
    }
  });
});

