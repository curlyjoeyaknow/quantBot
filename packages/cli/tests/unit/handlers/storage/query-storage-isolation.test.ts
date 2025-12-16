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
import { queryStorageHandler } from '../../../../src/handlers/storage/query-storage.js';
import * as storageCommands from '../../../../src/commands/storage.js';

vi.mock('../../../../src/commands/storage.js', async () => {
  const actual = await vi.importActual('../../../../src/commands/storage.js');
  return {
    ...actual,
    queryPostgresTable: vi.fn(),
    queryClickHouseTable: vi.fn(),
  };
});

describe('queryStorageHandler - Isolation Test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      table: 'tokens',
      limit: 10,
      format: 'json' as const,
    };

    // Plain object context (minimal mock)
    const plainCtx = {} as any;

    const mockData = [{ id: 1, name: 'test' }];
    vi.mocked(storageCommands.queryPostgresTable).mockResolvedValue(mockData);

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await queryStorageHandler(plainArgs, plainCtx);

    // Deterministic result
    expect(result).toEqual(mockData);
    expect(storageCommands.queryPostgresTable).toHaveBeenCalledWith('tokens', 10);
  });

  it('returns the same result for the same inputs (deterministic)', async () => {
    const args1 = {
      table: 'ohlcv_candles',
      limit: 100,
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    const mockResult = [{ id: 1 }, { id: 2 }];

    vi.mocked(storageCommands.queryClickHouseTable).mockResolvedValue(mockResult);

    const ctx1 = {} as any;
    const ctx2 = {} as any;

    const result1 = await queryStorageHandler(args1, ctx1);
    const result2 = await queryStorageHandler(args2, ctx2);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(mockResult);
  });
});
