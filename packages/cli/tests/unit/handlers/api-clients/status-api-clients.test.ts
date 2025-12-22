import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statusApiClientsHandler } from '../../../../src/commands/api-clients/status-api-clients.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('statusApiClientsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should return status for all services when service is "all"', async () => {
    const args = {
      service: 'all' as const,
      format: 'table' as const,
    };

    const result = await statusApiClientsHandler(args, mockCtx);

    expect(result).toEqual({
      birdeye: { status: 'operational' },
      helius: { status: 'operational' },
    });
  });

  it('should return status for birdeye only', async () => {
    const args = {
      service: 'birdeye' as const,
      format: 'table' as const,
    };

    const result = await statusApiClientsHandler(args, mockCtx);

    expect(result).toEqual({
      birdeye: { status: 'operational' },
    });
  });

  it('should return status for helius only', async () => {
    const args = {
      service: 'helius' as const,
      format: 'table' as const,
    };

    const result = await statusApiClientsHandler(args, mockCtx);

    expect(result).toEqual({
      helius: { status: 'operational' },
    });
  });

  it('should return status for all when service is undefined', async () => {
    const args = {
      service: undefined,
      format: 'table' as const,
    };

    const result = await statusApiClientsHandler(args, mockCtx);

    expect(result).toEqual({
      birdeye: { status: 'operational' },
      helius: { status: 'operational' },
    });
  });
});
