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
import { SAFE_TABLES } from '../../../../src/commands/storage.js';

describe('statsStorageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKHOUSE_DATABASE = 'quantbot';
  });

  it('returns stats from ClickHouse tables', async () => {
    // Mock ClickHouse client (minimal mock - testing handler's single responsibility)
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    // Setup ClickHouse mocks for each table
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '200' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    const args = {
      format: 'json' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // Verify result is an array (handler returns array of rows)
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<Record<string, unknown>>;
    
    // Verify each table has a row
    expect(rows.length).toBe(SAFE_TABLES.clickhouse.length);
    for (const table of SAFE_TABLES.clickhouse) {
      const row = rows.find((r) => r.table === table);
      expect(row).toBeDefined();
      expect(row?.count).toBe(200);
      expect(row?.storage).toBe('clickhouse');
    }

    // Verify ClickHouse client was called correctly
    expect(mockClickHouseQuery).toHaveBeenCalledTimes(SAFE_TABLES.clickhouse.length);
    for (const table of SAFE_TABLES.clickhouse) {
      expect(mockClickHouseQuery).toHaveBeenCalledWith({
        query: `SELECT COUNT(*) as count FROM quantbot.${table}`,
        format: 'JSONEachRow',
      });
    }
  });

  it('handles ClickHouse query errors gracefully', async () => {
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    // First table succeeds, second fails, third succeeds
    const tables = SAFE_TABLES.clickhouse;
    for (let i = 0; i < tables.length; i++) {
      if (i === 1) {
        // Second table fails
        mockClickHouseQuery.mockRejectedValueOnce(new Error('Table query failed'));
      } else {
        const mockResult = {
          json: vi.fn().mockResolvedValue([{ count: '50' }]),
        };
        mockClickHouseQuery.mockResolvedValueOnce(mockResult);
      }
    }

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    const args = {
      format: 'table' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // Result should be an array
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<Record<string, unknown>>;
    
    // Should have rows for successful queries and error row for failed query
    expect(rows.length).toBeGreaterThan(0);
    
    // Find the error row
    const errorRow = rows.find((r) => r.error);
    expect(errorRow).toBeDefined();
    expect(errorRow?.error).toBe('Table query failed');
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
