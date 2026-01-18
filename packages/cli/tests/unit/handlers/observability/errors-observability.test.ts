import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorsObservabilityHandler } from '../../../../src/commands/observability/errors-observability.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { getErrorStats } from '@quantbot/infra/observability';

vi.mock('@quantbot/infra/observability', () => ({
  getErrorStats: vi.fn(),
}));

describe('errorsObservabilityHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should call getErrorStats with date range', async () => {
    const mockStats = {
      total: 10,
      bySeverity: {
        error: 5,
        warning: 3,
        critical: 2,
      },
      recent: [],
    };

    vi.mocked(getErrorStats).mockResolvedValue(mockStats);

    const args = {
      from: '2024-01-01',
      to: '2024-01-31',
      limit: 100,
      format: 'table' as const,
    };

    const result = await errorsObservabilityHandler(args, mockCtx);

    expect(getErrorStats).toHaveBeenCalledWith({
      from: new Date('2024-01-01'),
      to: new Date('2024-01-31'),
    });
    expect(result).toEqual(mockStats);
  });

  it('should default to last 24 hours when dates not provided', async () => {
    const mockStats = {
      total: 5,
      bySeverity: {},
      recent: [],
    };

    vi.mocked(getErrorStats).mockResolvedValue(mockStats);

    const args = {
      from: undefined,
      to: undefined,
      limit: 50,
      format: 'json' as const,
    };

    const beforeCall = Date.now();
    await errorsObservabilityHandler(args, mockCtx);
    const afterCall = Date.now();

    expect(getErrorStats).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(getErrorStats).mock.calls[0][0];

    // Check that 'to' is recent (within 1 second)
    expect(callArgs.to.getTime()).toBeGreaterThanOrEqual(beforeCall - 1000);
    expect(callArgs.to.getTime()).toBeLessThanOrEqual(afterCall + 1000);

    // Check that 'from' is approximately 24 hours before 'to'
    const expectedFrom = callArgs.to.getTime() - 24 * 60 * 60 * 1000;
    expect(callArgs.from.getTime()).toBeGreaterThanOrEqual(expectedFrom - 1000);
    expect(callArgs.from.getTime()).toBeLessThanOrEqual(expectedFrom + 1000);
  });

  it('should propagate errors', async () => {
    const error = new Error('Failed to get error stats');
    vi.mocked(getErrorStats).mockRejectedValue(error);

    const args = {
      from: '2024-01-01',
      to: '2024-01-31',
      limit: 100,
      format: 'table' as const,
    };

    await expect(errorsObservabilityHandler(args, mockCtx)).rejects.toThrow(
      'Failed to get error stats'
    );
  });
});
