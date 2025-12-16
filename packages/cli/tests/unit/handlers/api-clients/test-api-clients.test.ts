import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testApiClientsHandler } from '../../../../src/handlers/api-clients/test-api-clients.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { BirdeyeClient, HeliusClient } from '@quantbot/api-clients';

vi.mock('@quantbot/api-clients', () => ({
  BirdeyeClient: vi.fn(),
  HeliusClient: vi.fn(),
}));

describe('testApiClientsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should test birdeye service', async () => {
    const args = {
      service: 'birdeye' as const,
      format: 'table' as const,
    };

    const result = await testApiClientsHandler(args, mockCtx);

    expect(BirdeyeClient).toHaveBeenCalled();
    expect(result).toEqual({
      service: 'birdeye',
      status: 'connected',
      message: 'Connection test successful',
    });
  });

  it('should test helius service', async () => {
    const args = {
      service: 'helius' as const,
      format: 'table' as const,
    };

    const result = await testApiClientsHandler(args, mockCtx);

    expect(HeliusClient).toHaveBeenCalledWith({});
    expect(result).toEqual({
      service: 'helius',
      status: 'connected',
      message: 'Connection test successful',
    });
  });

  it('should throw error for unknown service', async () => {
    const args = {
      service: 'unknown' as any,
      format: 'table' as const,
    };

    await expect(testApiClientsHandler(args, mockCtx)).rejects.toThrow('Unknown service');
  });
});
