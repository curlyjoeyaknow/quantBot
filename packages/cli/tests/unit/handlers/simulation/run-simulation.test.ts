import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSimulationHandler } from '../../../../src/commands/simulation/run-simulation.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import type { RunRepository } from '@quantbot/storage';

vi.mock('@quantbot/workflows', () => ({
  runSimulation: vi.fn(),
  createProductionContext: vi.fn(),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-123'),
}));

describe('runSimulationHandler', () => {
  let mockCtx: CommandContext;
  let mockRunRepo: RunRepository;
  const mockWorkflowContext = {
    ids: { newRunId: vi.fn(() => 'test-uuid-123') },
    clock: { nowISO: () => DateTime.utc().toISO()! },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    repos: {},
    ohlcv: {},
    simulation: {},
  };

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
    vi.mocked(createProductionContext).mockReturnValue(mockWorkflowContext as any);
  });

  it('happy path: generates run_id, creates run record, inserts metrics, marks success', async () => {
    const mockResult = {
      runId: 'test-uuid-123',
      strategyName: 'PT2_SL25',
      callerName: 'Brook',
      fromISO: '2024-01-01T00:00:00.000Z',
      toISO: '2024-02-01T00:00:00.000Z',
      dryRun: false,
      totals: {
        callsFound: 10,
        callsAttempted: 10,
        callsSucceeded: 8,
        callsFailed: 2,
        tradesTotal: 8,
      },
      pnl: {
        mean: 1.12, // +12% ROI
        min: 0.95,
        max: 1.25,
      },
    };

    vi.mocked(runSimulation).mockResolvedValue(mockResult as any);

    const args = {
      strategy: 'PT2_SL25',
      caller: 'Brook',
      from: '2024-01-01',
      to: '2024-02-01',
      interval: '1m' as const,
      preWindow: 0,
      postWindow: 0,
      dryRun: false,
      concurrency: 8,
      format: 'table' as const,
    };

    const result = await runSimulationHandler(args, mockCtx);

    // Verify run record was created
    expect(mockRunRepo.createRun).toHaveBeenCalledOnce();
    const createRunCall = vi.mocked(mockRunRepo.createRun).mock.calls[0]![0];
    expect(createRunCall.run_id).toBe('test-uuid-123');
    expect(createRunCall.strategy_id).toBe('PT2_SL25');
    expect(createRunCall.interval_sec).toBe(60); // 1m = 60s
    expect(createRunCall.universe_ref).toBe('caller:Brook');

    // Verify metrics were inserted
    expect(mockRunRepo.insertMetrics).toHaveBeenCalledOnce();
    const insertMetricsCall = vi.mocked(mockRunRepo.insertMetrics).mock.calls[0];
    expect(insertMetricsCall[0]).toBe('test-uuid-123'); // run_id
    expect(insertMetricsCall[1]).toMatchObject({
      roi: 1.12,
      trades: 8,
      win_rate: 0.8, // 8/10
    });

    // Verify run was marked as success
    expect(mockRunRepo.finishRun).toHaveBeenCalledOnce();
    expect(mockRunRepo.finishRun).toHaveBeenCalledWith(
      'test-uuid-123',
      'success',
      expect.any(Date)
    );

    // Verify workflow was called with our runId
    expect(runSimulation).toHaveBeenCalled();
    const workflowCall = vi.mocked(runSimulation).mock.calls[0];
    expect(workflowCall[1]?.ids.newRunId()).toBe('test-uuid-123');

    expect(result).toEqual(mockResult);
  });

  it('failure path: still records run as failed and surfaces error', async () => {
    const error = new Error('Simulation failed');
    vi.mocked(runSimulation).mockRejectedValue(error);

    const args = {
      strategy: 'PT2_SL25',
      caller: 'Brook',
      from: '2024-01-01',
      to: '2024-02-01',
      interval: '5m' as const,
      preWindow: 0,
      postWindow: 0,
      dryRun: false,
      concurrency: 8,
      format: 'table' as const,
    };

    await expect(runSimulationHandler(args, mockCtx)).rejects.toThrow('Simulation failed');

    // Verify run record was created before failure
    expect(mockRunRepo.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run_id: 'test-uuid-123',
        strategy_id: 'PT2_SL25',
        interval_sec: 300, // 5m = 300 seconds
      })
    );

    // Verify marked as failed
    expect(mockRunRepo.finishRun).toHaveBeenCalledWith('test-uuid-123', 'failed', expect.any(Date));

    // Verify metrics were NOT inserted (workflow failed)
    expect(mockRunRepo.insertMetrics).not.toHaveBeenCalled();
  });

  it('should handle interval conversion correctly', async () => {
    const mockResult = {
      runId: 'test-uuid-123',
      strategyName: 'PT2_SL25',
      fromISO: '2024-01-01T00:00:00.000Z',
      toISO: '2024-02-01T00:00:00.000Z',
      dryRun: false,
      totals: {
        callsFound: 0,
        callsAttempted: 0,
        callsSucceeded: 0,
        callsFailed: 0,
        tradesTotal: 0,
      },
      pnl: {},
    };

    vi.mocked(runSimulation).mockResolvedValue(mockResult as any);

    const intervals = [
      { interval: '1m' as const, expected: 60 },
      { interval: '5m' as const, expected: 300 },
      { interval: '15m' as const, expected: 900 },
      { interval: '1h' as const, expected: 3600 },
    ];

    for (const { interval, expected } of intervals) {
      vi.clearAllMocks();
      const args = {
        strategy: 'PT2_SL25',
        from: '2024-01-01',
        to: '2024-02-01',
        interval,
        preWindow: 0,
        postWindow: 0,
        dryRun: false,
        concurrency: 8,
        format: 'table' as const,
      };

      await runSimulationHandler(args, mockCtx);

      expect(mockRunRepo.createRun).toHaveBeenCalledWith(
        expect.objectContaining({
          interval_sec: expected,
        })
      );
    }
  });
});
