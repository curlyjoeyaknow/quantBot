import { describe, it, expect, vi, beforeEach } from 'vitest';
import { leaderboardHandler } from '../../../../src/commands/simulation/leaderboard.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';
import type { RunRepository } from '@quantbot/infra/storage';
import type { LeaderboardEntry } from '@quantbot/core';

describe('leaderboardHandler', () => {
  let mockCtx: CommandContext;
  let mockRunRepo: RunRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunRepo = {
      createRun: vi.fn(),
      finishRun: vi.fn(),
      insertMetrics: vi.fn(),
      insertSliceAudit: vi.fn(),
      listRuns: vi.fn(),
      leaderboard: vi.fn().mockResolvedValue([]),
    };
    mockCtx = {
      ensureInitialized: vi.fn().mockResolvedValue(undefined),
      services: {
        runRepository: () => mockRunRepo,
      },
    } as unknown as CommandContext;
  });

  it('calls repo with filters: maps args to LeaderboardFilters correctly', async () => {
    const mockEntries: LeaderboardEntry[] = [
      {
        run_id: 'run-1',
        created_at: DateTime.fromISO('2024-01-15T10:00:00Z'),
        strategy_id: 'PT2_SL25',
        interval_sec: 300,
        roi: 1.25,
        max_drawdown: 50,
        trades: 10,
        win_rate: 0.8,
        pnl_quote: 250,
      },
    ];

    vi.mocked(mockRunRepo.leaderboard).mockResolvedValue(mockEntries);

    const args = {
      strategy_id: 'PT2_SL25',
      interval_sec: 300,
      from: '2024-01-01',
      to: '2024-01-31',
      min_trades: 5,
      limit: 20,
      format: 'table' as const,
    };

    const result = await leaderboardHandler(args, mockCtx);

    expect(mockCtx.ensureInitialized).toHaveBeenCalled();
    expect(mockRunRepo.leaderboard).toHaveBeenCalledWith({
      strategy_id: 'PT2_SL25',
      interval_sec: 300,
      from: expect.any(DateTime),
      to: expect.any(DateTime),
      min_trades: 5,
      limit: 20,
    });

    const filters = vi.mocked(mockRunRepo.leaderboard).mock.calls[0]?.[0];
    expect(filters?.from?.toISO()).toBe('2024-01-01T00:00:00.000Z');
    expect(filters?.to?.toISO()).toBe('2024-01-31T00:00:00.000Z');

    expect(result).toEqual(mockEntries);
  });

  it('calls repo with default limit when not provided', async () => {
    const args = {
      strategy_id: undefined,
      interval_sec: undefined,
      from: undefined,
      to: undefined,
      min_trades: undefined,
      limit: undefined,
      format: 'table' as const,
    };

    await leaderboardHandler(args, mockCtx);

    // Schema defaults limit to 50 when not provided
    expect(mockRunRepo.leaderboard).toHaveBeenCalledWith({
      strategy_id: undefined,
      interval_sec: undefined,
      from: undefined,
      to: undefined,
      min_trades: undefined,
      limit: 50, // Default from schema
    });
  });

  it('sorts/filters correctly: returns results from repo (repo handles sorting)', async () => {
    const mockEntries: LeaderboardEntry[] = [
      {
        run_id: 'run-1',
        created_at: DateTime.fromISO('2024-01-15T10:00:00Z'),
        strategy_id: 'PT2_SL25',
        interval_sec: 300,
        roi: 1.5, // Highest ROI
        max_drawdown: 30,
        trades: 15,
        win_rate: 0.9,
        pnl_quote: 500,
      },
      {
        run_id: 'run-2',
        created_at: DateTime.fromISO('2024-01-14T10:00:00Z'),
        strategy_id: 'PT2_SL25',
        interval_sec: 300,
        roi: 1.2, // Lower ROI
        max_drawdown: 50,
        trades: 10,
        win_rate: 0.8,
        pnl_quote: 200,
      },
    ];

    vi.mocked(mockRunRepo.leaderboard).mockResolvedValue(mockEntries);

    const args = {
      limit: 10,
      format: 'table' as const,
    };

    const result = await leaderboardHandler(args, mockCtx);

    // Handler just passes through - repo handles sorting by ROI DESC
    expect(result).toEqual(mockEntries);
    expect(result[0]?.roi).toBeGreaterThan(result[1]?.roi);
  });
});
