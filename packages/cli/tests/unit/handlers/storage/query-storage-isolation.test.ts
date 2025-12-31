/**
 * Isolation Test - Litmus Test for queryStorageHandler
 *
 * This test verifies the handler can be:
 * - Imported into a REPL
 * - Called with plain objects
 * - Returns deterministic results
 *
 * If this test passes, the handler is properly decoupled from CLI infrastructure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryStorageHandler } from '../../../../src/commands/storage/query-storage.js';
import { getClickHouseDatabaseName } from '@quantbot/utils';

describe('queryStorageHandler - Isolation Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      table: 'ohlcv_candles', // Use ClickHouse table (PostgreSQL removed)
      limit: 10,
      format: 'json' as const,
    };

    // Plain object context (minimal mock - testing guardrail: handler uses ctx.services)
    const mockClickHouseClient = {
      query: vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([{ id: 1, name: 'test' }]),
      }),
    };

    const plainCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await queryStorageHandler(plainArgs, plainCtx);

    // Deterministic result
    expect(Array.isArray(result)).toBe(true);
    expect(mockClickHouseClient.query).toHaveBeenCalled();
  });

  it('returns the same result for the same inputs (deterministic)', async () => {
    const args1 = {
      table: 'ohlcv_candles',
      limit: 100,
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    const mockResult = [{ id: 1 }, { id: 2 }];
    const mockClickHouseClient = {
      query: vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue(mockResult),
      }),
    };

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

    const result1 = await queryStorageHandler(args1, ctx1);
    const result2 = await queryStorageHandler(args2, ctx2);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(mockResult);
  });
});
