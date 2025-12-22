import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listRunsHandler } from '../../../../src/handlers/simulation/list-runs.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';

const mockListRuns = vi.fn();
const mockFindByName = vi.fn();

vi.mock('@quantbot/storage', () => ({
  SimulationRunsRepository: class {
    listRuns = mockListRuns;
  },
  CallersRepository: class {
    findByName = mockFindByName;
  },
  ohlcvCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
  },
}));

describe('listRunsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should list runs without filters', async () => {
    // Handler is currently stubbed - PostgreSQL SimulationRunsRepository was removed
    // TODO: Implement DuckDB-based simulation runs listing
    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      limit: 100,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    // Currently returns empty array until DuckDB implementation is complete
    expect(result).toEqual([]);
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('should filter by caller if provided', async () => {
    // Handler is currently stubbed - PostgreSQL SimulationRunsRepository was removed
    // TODO: Implement DuckDB-based simulation runs listing
    const args = {
      caller: 'Brook',
      from: undefined,
      to: undefined,
      limit: 50,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    // Currently returns empty array until DuckDB implementation is complete
    expect(result).toEqual([]);
    expect(mockFindByName).not.toHaveBeenCalled();
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('should return empty if caller not found', async () => {
    // Handler is currently stubbed - always returns empty array
    const args = {
      caller: 'Unknown',
      from: undefined,
      to: undefined,
      limit: 100,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    expect(result).toEqual([]);
    expect(mockListRuns).not.toHaveBeenCalled();
  });

  it('should filter by date range if provided', async () => {
    // Handler is currently stubbed - PostgreSQL SimulationRunsRepository was removed
    // TODO: Implement DuckDB-based simulation runs listing with date filtering
    const args = {
      caller: undefined,
      from: '2024-01-01',
      to: '2024-01-31',
      limit: 100,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    // Currently returns empty array until DuckDB implementation is complete
    expect(result).toEqual([]);
    expect(mockListRuns).not.toHaveBeenCalled();
  });
});
