import { describe, it, expect, vi, beforeEach } from 'vitest';
import { quotasObservabilityHandler } from '../../../../src/commands/observability/quotas-observability.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { checkApiQuotas } from '@quantbot/infra/observability';

vi.mock('@quantbot/infra/observability', () => ({
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
    // For table format, should return array of rows
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
    expect((result as any[])[0].service).toBe('birdeye');
    expect((result as any[])[1].service).toBe('helius');
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

    // For table format, should return array with single row
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(1);
    expect((result as any[])[0].service).toBe('birdeye');
    expect((result as any[])[0].limit).toBe(100000);
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

    // For table format, should return array of rows
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
    expect((result as any[])[0].service).toBe('birdeye');
    expect((result as any[])[1].service).toBe('helius');
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
