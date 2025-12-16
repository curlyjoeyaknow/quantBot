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
}));

describe('listRunsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should list runs without filters', async () => {
    const mockRuns = [
      {
        id: 1,
        strategyId: 1,
        runType: 'backtest',
        status: 'completed',
        createdAt: DateTime.now(),
      },
    ];

    mockListRuns.mockResolvedValue(mockRuns);

    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      limit: 100,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    expect(mockListRuns).toHaveBeenCalledWith({ limit: 100 });
    expect(result).toEqual(mockRuns);
  });

  it('should filter by caller if provided', async () => {
    const mockCaller = {
      id: 5,
      source: 'telegram',
      handle: 'Brook',
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    };

    mockFindByName.mockResolvedValueOnce(mockCaller);
    mockListRuns.mockResolvedValue([]);

    const args = {
      caller: 'Brook',
      from: undefined,
      to: undefined,
      limit: 50,
      format: 'table' as const,
    };

    await listRunsHandler(args, mockCtx);

    expect(mockFindByName).toHaveBeenCalledWith('telegram', 'Brook');
    expect(mockListRuns).toHaveBeenCalledWith({ callerId: 5, limit: 50 });
  });

  it('should return empty if caller not found', async () => {
    mockFindByName
      .mockResolvedValueOnce(null) // telegram
      .mockResolvedValueOnce(null); // solana

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
    const fromDate = DateTime.fromISO('2024-01-01', { zone: 'utc' });
    const toDate = DateTime.fromISO('2024-01-31', { zone: 'utc' });

    const mockRuns = [
      {
        id: 1,
        createdAt: DateTime.fromISO('2024-01-15', { zone: 'utc' }),
      },
      {
        id: 2,
        createdAt: DateTime.fromISO('2024-02-01', { zone: 'utc' }), // Outside range
      },
    ];

    mockListRuns.mockResolvedValue(mockRuns);

    const args = {
      caller: undefined,
      from: '2024-01-01',
      to: '2024-01-31',
      limit: 100,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });
});
