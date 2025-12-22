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

  it('skips tables that do not exist', async () => {
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    // First table succeeds, second doesn't exist, third succeeds
    const tables = SAFE_TABLES.clickhouse;
    for (let i = 0; i < tables.length; i++) {
      if (i === 1) {
        // Second table doesn't exist - handler should skip it
        mockClickHouseQuery.mockRejectedValueOnce(new Error("Table quantbot.ohlcv doesn't exist"));
      } else {
        const mockResult = {
          json: vi.fn().mockResolvedValue([{ count: '75' }]),
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
      format: 'json' as const,
    };

    const result = await statsStorageHandler(args, fakeCtx);

    // Result should be an array
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<Record<string, unknown>>;

    // Should not include the non-existent table
    const nonExistentTable = tables[1];
    const nonExistentRow = rows.find((r) => r.table === nonExistentTable);
    expect(nonExistentRow).toBeUndefined();

    // Should include successful tables
    expect(rows.length).toBe(tables.length - 1);
  });

  it('handles missing format parameter', async () => {
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    // Setup ClickHouse mocks
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '0' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    const args = {}; // No format

    const result = await statsStorageHandler(args, fakeCtx);

    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
  });

  it('returns zero counts when tables have no data', async () => {
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    // Setup ClickHouse mocks with empty results
    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '0' }]),
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

    // All counts should be 0
    const rows = result as Array<Record<string, unknown>>;
    for (const table of SAFE_TABLES.clickhouse) {
      const row = rows.find((r) => r.table === table);
      expect(row?.count).toBe(0);
    }
  });
});
