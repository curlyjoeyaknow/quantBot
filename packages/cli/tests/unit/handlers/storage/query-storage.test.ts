/**
 * Unit tests for queryStorageHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryStorageHandler } from '../../../../src/commands/storage/query-storage.js';
import * as storageCommands from '../../../../src/commands/storage.js';
import { getClickHouseDatabaseName } from '@quantbot/utils';

// Mock ClickHouse client
const mockClickHouseClient = {
  query: vi.fn(),
};

vi.mock('../../../../src/core/command-context.js', () => ({
  // Mock CommandContext type
}));

describe('queryStorageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ClickHouse client for ClickHouse tables', async () => {
    const mockData = [
      { id: 1, name: 'test' },
      { id: 2, name: 'test2' },
    ];

    const mockQueryResult = {
      json: vi.fn().mockResolvedValue(mockData),
    };

    mockClickHouseClient.query.mockResolvedValue(mockQueryResult);

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();
    const database = getClickHouseDatabaseName();

    const args = {
      table: 'ohlcv_candles',
      limit: 100,
      format: 'json' as const,
    };

    const result = await queryStorageHandler(args, fakeCtx);

    expect(mockClickHouseClient.query).toHaveBeenCalledTimes(1);
    expect(mockClickHouseClient.query).toHaveBeenCalledWith({
      query: `SELECT * FROM ${database}.ohlcv_candles LIMIT 100`,
      format: 'JSONEachRow',
    });
    expect(result).toEqual(mockData);
    expect(result).toEqual(mockData);
  });

  it('throws ValidationError for non-ClickHouse tables', async () => {
    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    const args = {
      table: 'tokens', // Not in SAFE_TABLES.clickhouse
      limit: 50,
      format: 'table' as const,
    };

    await expect(queryStorageHandler(args, fakeCtx)).rejects.toThrow(
      'Only ClickHouse tables are supported'
    );
  });

  it('handles case-insensitive table names', async () => {
    const mockData = [{ id: 1 }];
    const mockQueryResult = {
      json: vi.fn().mockResolvedValue(mockData),
    };
    mockClickHouseClient.query.mockResolvedValue(mockQueryResult);

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();
    const database = getClickHouseDatabaseName();

    const args = {
      table: 'OHLCV_CANDLES', // Uppercase
      limit: 10,
      format: 'json' as const,
    };

    const result = await queryStorageHandler(args, fakeCtx);

    // Handler converts table name to lowercase for query
    expect(mockClickHouseClient.query).toHaveBeenCalledWith({
      query: `SELECT * FROM ${database}.ohlcv_candles LIMIT 10`,
      format: 'JSONEachRow',
    });
    expect(result).toEqual(mockData);
  });

  it('propagates errors from ClickHouse client', async () => {
    const queryError = new Error('Database connection failed');
    mockClickHouseClient.query.mockRejectedValue(queryError);

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();

    const args = {
      table: 'ohlcv_candles',
      limit: 10,
      format: 'json' as const,
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(queryStorageHandler(args, fakeCtx)).rejects.toThrow('Database connection failed');
    expect(mockClickHouseClient.query).toHaveBeenCalledTimes(1);
  });

  it('handles different limit values', async () => {
    const mockData = [{ id: 1 }];
    const mockQueryResult = {
      json: vi.fn().mockResolvedValue(mockData),
    };
    mockClickHouseClient.query.mockResolvedValue(mockQueryResult);

    const fakeCtx = {
      services: {
        clickHouseClient: () => mockClickHouseClient,
      },
    } as any;

    process.env.CLICKHOUSE_DATABASE = getClickHouseDatabaseName();
    const database = getClickHouseDatabaseName();

    const limits = [1, 10, 100, 1000, 10000];

    for (const limit of limits) {
      const args = {
        table: 'ohlcv_candles',
        limit,
        format: 'json' as const,
      };

      await queryStorageHandler(args, fakeCtx);
      expect(mockClickHouseClient.query).toHaveBeenCalledWith({
        query: `SELECT * FROM ${database}.ohlcv_candles LIMIT ${limit}`,
        format: 'JSONEachRow',
      });
    }

    expect(mockClickHouseClient.query).toHaveBeenCalledTimes(limits.length);
  });
});
