import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listRunsHandler } from '../../../../src/commands/simulation/list-runs.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';
import type { RunRepository } from '@quantbot/infra/storage';
import type { RunWithStatus } from '@quantbot/core';

describe('listRunsHandler', () => {
  let mockCtx: CommandContext;
  let mockRunRepo: RunRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunRepo = {
      createRun: vi.fn().mockResolvedValue(undefined),
      finishRun: vi.fn().mockResolvedValue(undefined),
      insertMetrics: vi.fn().mockResolvedValue(undefined),
      insertSliceAudit: vi.fn().mockResolvedValue(undefined),
      listRuns: vi.fn().mockResolvedValue([]),
      leaderboard: vi.fn().mockResolvedValue([]),
    };
    mockCtx = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      services: {
        runRepository: () => mockRunRepo,
      },
    } as unknown as CommandContext;
  });

  it('calls repo with filters: maps args to RunRepository filters correctly', async () => {
    const mockRuns: RunWithStatus[] = [
      {
        run_id: 'run-1',
        created_at: DateTime.fromISO('2024-01-15T10:00:00Z'),
        strategy_id: 'PT2_SL25',
        interval_sec: 300,
        time_from: DateTime.fromISO('2024-01-01T00:00:00Z'),
        time_to: DateTime.fromISO('2024-01-31T23:59:59Z'),
        status: 'success',
        params_json: '{}',
      },
    ];

    vi.mocked(mockRunRepo.listRuns).mockResolvedValue(mockRuns);

    const args = {
      caller: undefined,
      from: '2024-01-01',
      to: '2024-01-31',
      limit: 50,
      format: 'table' as const,
    };

    const result = await listRunsHandler(args, mockCtx);

    expect(mockCtx.ensureInitialized).toHaveBeenCalled();
    expect(mockRunRepo.listRuns).toHaveBeenCalledWith({
      from: expect.any(DateTime),
      to: expect.any(DateTime),
      limit: 50,
    });

    const filters = vi.mocked(mockRunRepo.listRuns).mock.calls[0]?.[0];
    expect(filters?.from?.toISO()).toBe('2024-01-01T00:00:00.000Z');
    expect(filters?.to?.toISO()).toBe('2024-01-31T00:00:00.000Z');

    expect(result).toEqual(mockRuns);
  });

  it('calls repo without filters when args are undefined', async () => {
    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      limit: 100,
      format: 'table' as const,
    };

    await listRunsHandler(args, mockCtx);

    expect(mockRunRepo.listRuns).toHaveBeenCalledWith({
      from: undefined,
      to: undefined,
      limit: 100,
    });
  });

  it('uses default limit when not provided', async () => {
    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      limit: undefined,
      format: 'table' as const,
    };

    await listRunsHandler(args, mockCtx);

    expect(mockRunRepo.listRuns).toHaveBeenCalledWith({
      from: undefined,
      to: undefined,
      limit: undefined,
    });
  });
});
