import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSimulationHandler } from '../../../../src/commands/simulation/run-simulation.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';

vi.mock('@quantbot/workflows', () => ({
  runSimulation: vi.fn(),
  createProductionContext: vi.fn(),
}));

describe('runSimulationHandler', () => {
  let mockCtx: CommandContext;
  const mockWorkflowContext = { id: 'mock-context' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
    vi.mocked(createProductionContext).mockReturnValue(mockWorkflowContext as any);
  });

  it('should call runSimulation with correct spec', async () => {
    const mockResult = {
      runId: 'test-run-id',
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

    expect(createProductionContext).toHaveBeenCalled();
    expect(runSimulation).toHaveBeenCalledWith(
      {
        strategyName: 'PT2_SL25',
        callerName: 'Brook',
        from: expect.any(DateTime),
        to: expect.any(DateTime),
        options: {
          preWindowMinutes: 0,
          postWindowMinutes: 0,
          dryRun: false,
        },
      },
      mockWorkflowContext
    );
    expect(result).toEqual(mockResult);
  });

  it('should handle optional caller', async () => {
    const mockResult = {
      runId: 'test-run-id',
      strategyName: 'PT2_SL25',
      callerName: undefined,
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
    };

    vi.mocked(runSimulation).mockResolvedValue(mockResult as any);

    const args = {
      strategy: 'PT2_SL25',
      caller: undefined,
      from: '2024-01-01',
      to: '2024-02-01',
      interval: '1m' as const,
      preWindow: 60,
      postWindow: 120,
      dryRun: true,
      concurrency: 4,
      format: 'table' as const,
    };

    await runSimulationHandler(args, mockCtx);

    expect(runSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        strategyName: 'PT2_SL25',
        callerName: undefined,
        options: {
          preWindowMinutes: 60,
          postWindowMinutes: 120,
          dryRun: true,
        },
      }),
      expect.anything()
    );
  });

  it('should propagate errors', async () => {
    const error = new Error('Simulation failed');
    vi.mocked(runSimulation).mockRejectedValue(error);

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

    await expect(runSimulationHandler(args, mockCtx)).rejects.toThrow('Simulation failed');
  });
});
