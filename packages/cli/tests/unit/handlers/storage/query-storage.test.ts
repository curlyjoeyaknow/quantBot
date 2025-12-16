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
import { queryStorageHandler } from '../../../../src/handlers/storage/query-storage.js';
import * as storageCommands from '../../../../src/commands/storage.js';

// Mock the query functions
vi.mock('../../../../src/commands/storage.js', async () => {
  const actual = await vi.importActual('../../../../src/commands/storage.js');
  return {
    ...actual,
    queryPostgresTable: vi.fn(),
    queryClickHouseTable: vi.fn(),
  };
});

describe('queryStorageHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls queryClickHouseTable for ClickHouse tables', async () => {
    const mockData = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];
    vi.mocked(storageCommands.queryClickHouseTable).mockResolvedValue(mockData);

    const fakeCtx = {} as any;

    const args = {
      table: 'ohlcv_candles',
      limit: 100,
      format: 'json' as const,
    };

    const result = await queryStorageHandler(args, fakeCtx);

    expect(storageCommands.queryClickHouseTable).toHaveBeenCalledTimes(1);
    expect(storageCommands.queryClickHouseTable).toHaveBeenCalledWith('ohlcv_candles', 100);
    expect(storageCommands.queryPostgresTable).not.toHaveBeenCalled();
    expect(result).toEqual(mockData);
  });

  it('calls queryPostgresTable for Postgres tables', async () => {
    const mockData = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];
    vi.mocked(storageCommands.queryPostgresTable).mockResolvedValue(mockData);

    const fakeCtx = {} as any;

    const args = {
      table: 'tokens',
      limit: 50,
      format: 'table' as const,
    };

    const result = await queryStorageHandler(args, fakeCtx);

    expect(storageCommands.queryPostgresTable).toHaveBeenCalledTimes(1);
    expect(storageCommands.queryPostgresTable).toHaveBeenCalledWith('tokens', 50);
    expect(storageCommands.queryClickHouseTable).not.toHaveBeenCalled();
    expect(result).toEqual(mockData);
  });

  it('handles case-insensitive table names', async () => {
    const mockData = [{ id: 1 }];
    vi.mocked(storageCommands.queryPostgresTable).mockResolvedValue(mockData);

    const fakeCtx = {} as any;

    const args = {
      table: 'TOKENS', // Uppercase
      limit: 10,
      format: 'json' as const,
    };

    const result = await queryStorageHandler(args, fakeCtx);

    expect(storageCommands.queryPostgresTable).toHaveBeenCalledWith('TOKENS', 10);
    expect(result).toEqual(mockData);
  });

  it('propagates errors from query functions', async () => {
    const queryError = new Error('Database connection failed');
    vi.mocked(storageCommands.queryPostgresTable).mockRejectedValue(queryError);

    const fakeCtx = {} as any;

    const args = {
      table: 'tokens',
      limit: 10,
      format: 'json' as const,
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(queryStorageHandler(args, fakeCtx)).rejects.toThrow('Database connection failed');
    expect(storageCommands.queryPostgresTable).toHaveBeenCalledTimes(1);
  });

  it('handles different limit values', async () => {
    const mockData = [{ id: 1 }];
    vi.mocked(storageCommands.queryPostgresTable).mockResolvedValue(mockData);

    const fakeCtx = {} as any;

    const limits = [1, 10, 100, 1000, 10000];

    for (const limit of limits) {
      const args = {
        table: 'tokens',
        limit,
        format: 'json' as const,
      };

      await queryStorageHandler(args, fakeCtx);
      expect(storageCommands.queryPostgresTable).toHaveBeenCalledWith('tokens', limit);
    }

    expect(storageCommands.queryPostgresTable).toHaveBeenCalledTimes(limits.length);
  });
});

