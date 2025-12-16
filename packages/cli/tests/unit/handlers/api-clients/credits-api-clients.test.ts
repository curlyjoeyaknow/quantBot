import { describe, it, expect, vi, beforeEach } from 'vitest';
import { creditsApiClientsHandler } from '../../../../src/handlers/api-clients/credits-api-clients.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { checkApiQuotas } from '@quantbot/observability';

vi.mock('@quantbot/observability', () => ({
  checkApiQuotas: vi.fn(),
}));

describe('creditsApiClientsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should return all quotas when service is "all"', async () => {
    const mockQuotas = {
      birdeye: { used: 1000, limit: 100000, remaining: 99000 },
      helius: { used: 5000, limit: 5000000, remaining: 4995000 },
    };

    vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

    const args = {
      service: 'all' as const,
      format: 'table' as const,
    };

    const result = await creditsApiClientsHandler(args, mockCtx);

    expect(checkApiQuotas).toHaveBeenCalled();
    expect(result).toEqual(mockQuotas);
  });

  it('should return birdeye quota only', async () => {
    const mockQuotas = {
      birdeye: { used: 1000, limit: 100000, remaining: 99000 },
      helius: { used: 5000, limit: 5000000, remaining: 4995000 },
    };

    vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

    const args = {
      service: 'birdeye' as const,
      format: 'table' as const,
    };

    const result = await creditsApiClientsHandler(args, mockCtx);

    expect(result).toEqual({
      birdeye: { used: 1000, limit: 100000, remaining: 99000 },
    });
  });

  it('should return all quotas when service is undefined', async () => {
    const mockQuotas = {
      birdeye: { used: 1000, limit: 100000, remaining: 99000 },
      helius: { used: 5000, limit: 5000000, remaining: 4995000 },
    };

    vi.mocked(checkApiQuotas).mockResolvedValue(mockQuotas);

    const args = {
      service: undefined,
      format: 'table' as const,
    };

    const result = await creditsApiClientsHandler(args, mockCtx);

    expect(result).toEqual(mockQuotas);
  });

  it('should propagate errors', async () => {
    const error = new Error('Quota check failed');
    vi.mocked(checkApiQuotas).mockRejectedValue(error);

    const args = {
      service: 'all' as const,
      format: 'table' as const,
    };

    await expect(creditsApiClientsHandler(args, mockCtx)).rejects.toThrow('Quota check failed');
  });
});
