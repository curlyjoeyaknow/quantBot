import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quotasObservabilityHandler } from '../../../../src/handlers/observability/quotas-observability.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { checkApiQuotas } from '@quantbot/observability';

vi.mock('@quantbot/observability', () => ({
  checkApiQuotas: vi.fn(),
}));

describe('quotasObservabilityHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should return all quotas when service is "all"', async () => {
    const mockQuotas = {
      birdeye: {
        service: 'birdeye',
        limit: 100000,
        used: 1000,
        remaining: 99000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
      helius: {
        service: 'helius',
        limit: 5000000,
        used: 5000,
        remaining: 4995000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
    };

    vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

    const args = {
      service: 'all' as const,
      format: 'table' as const,
    };

    const result = await quotasObservabilityHandler(args, mockCtx);

    expect(checkApiQuotas).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockQuotas);
  });

  it('should return birdeye quota only', async () => {
    const mockQuotas = {
      birdeye: {
        service: 'birdeye',
        limit: 100000,
        used: 1000,
        remaining: 99000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
      helius: {
        service: 'helius',
        limit: 5000000,
        used: 5000,
        remaining: 4995000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
    };

    vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

    const args = {
      service: 'birdeye' as const,
      format: 'table' as const,
    };

    const result = await quotasObservabilityHandler(args, mockCtx);

    expect(result).toEqual({
      birdeye: mockQuotas.birdeye,
    });
  });

  it('should return all quotas when service is undefined', async () => {
    const mockQuotas = {
      birdeye: {
        service: 'birdeye',
        limit: 100000,
        used: 1000,
        remaining: 99000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
      helius: {
        service: 'helius',
        limit: 5000000,
        used: 5000,
        remaining: 4995000,
        resetAt: new Date(),
        warningThreshold: 0.2,
      },
    };

    vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

    const args = {
      service: undefined,
      format: 'table' as const,
    };

    const result = await quotasObservabilityHandler(args, mockCtx);

    expect(result).toEqual(mockQuotas);
  });

  it('should propagate errors', async () => {
    const error = new Error('Quota check failed');
    vi.mocked(checkApiQuotas).mockRejectedValue(error);

    const args = {
      service: 'all' as const,
      format: 'table' as const,
    };

    await expect(quotasObservabilityHandler(args, mockCtx)).rejects.toThrow('Quota check failed');
  });
});
