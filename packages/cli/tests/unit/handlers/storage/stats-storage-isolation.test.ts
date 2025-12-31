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
import { statsStorageHandler } from '../../../../src/commands/storage/stats-storage.js';
import { SAFE_TABLES } from '../../../../src/commands/storage.js';
import { getClickHouseDatabaseName } from '@quantbot/utils';

describe('statsStorageHandler - Isolation Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      format: 'json' as const,
    };

    // Plain object context (minimal mock - testing guardrail: handler uses ctx.services)
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    for (const table of SAFE_TABLES.clickhouse) {
      const mockResult = {
        json: vi.fn().mockResolvedValue([{ count: '100' }]),
      };
      mockClickHouseQuery.mockResolvedValueOnce(mockResult);
    }

    const plainCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await statsStorageHandler(plainArgs, plainCtx);

    // Deterministic result structure (handler returns array of rows)
    expect(Array.isArray(result)).toBe(true);
    expect((result as Array<Record<string, unknown>>).length).toBeGreaterThan(0);
  });

  it('returns the same result structure for the same inputs (deterministic)', async () => {
    const args1 = {
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    // Mock ClickHouse (minimal mock - testing guardrail)
    const mockClickHouseQuery = vi.fn();
    const mockClickHouseClient = {
      query: mockClickHouseQuery,
    };

    const mockResult = [{ count: '75' }];
    for (const table of SAFE_TABLES.clickhouse) {
      mockClickHouseQuery.mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockResult),
      });
    }

    const ctx1 = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    const ctx2 = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();

    const result1 = await statsStorageHandler(args1, ctx1);
    const result2 = await statsStorageHandler(args2, ctx2);

    // Results should have the same structure (both arrays)
    expect(Array.isArray(result1)).toBe(true);
    expect(Array.isArray(result2)).toBe(true);
    expect(result1).toEqual(result2);
  });
});
