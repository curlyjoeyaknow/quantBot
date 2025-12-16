import { describe, it, expect, vi, beforeEach } from 'vitest';
import { metricsAnalyticsHandler } from '../../../../src/handlers/analytics/metrics-analytics.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('metricsAnalyticsHandler', () => {
  let mockCtx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {} as CommandContext;
  });

  it('should return stub message', async () => {
    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      format: 'table' as const,
    };

    const result = await metricsAnalyticsHandler(args, mockCtx);

    expect(result).toEqual({
      message: 'Metrics calculation not yet implemented',
      note: 'This command will calculate period metrics for calls',
    });
  });
});
