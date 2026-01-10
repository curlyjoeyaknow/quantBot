import { describe, it, expect, vi, beforeEach } from 'vitest';
import { healthObservabilityHandler } from '../../../../src/commands/observability/health-observability.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { performHealthCheck } from '@quantbot/observability';

vi.mock('@quantbot/observability', () => ({
  performHealthCheck: vi.fn(),
}));

describe('healthObservabilityHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should call performHealthCheck and return result', async () => {
    const mockHealth = {
      status: 'healthy' as const,
      timestamp: new Date(),
      checks: {
        postgres: { status: 'ok' as const },
        clickhouse: { status: 'ok' as const },
        birdeye: { status: 'ok' as const },
        helius: { status: 'ok' as const },
      },
    };

    vi.mocked(performHealthCheck).mockResolvedValue(mockHealth);

    const args = {
      format: 'table' as const,
    };

    const result = await healthObservabilityHandler(args, mockCtx);

    expect(performHealthCheck).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockHealth);
  });

  it('should propagate errors', async () => {
    const error = new Error('Health check failed');
    vi.mocked(performHealthCheck).mockRejectedValue(error);

    const args = {
      format: 'json' as const,
    };

    await expect(healthObservabilityHandler(args, mockCtx)).rejects.toThrow('Health check failed');
  });
});
