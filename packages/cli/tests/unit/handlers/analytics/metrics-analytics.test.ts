import { describe, it, expect, vi, beforeEach } from 'vitest';
import { metricsAnalyticsHandler } from '../../../../src/handlers/analytics/metrics-analytics.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('metricsAnalyticsHandler', () => {
  let mockCtx: CommandContext;
  let mockAnalyticsEngine: {
    analyzeCalls: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyticsEngine = {
      analyzeCalls: vi.fn().mockResolvedValue({
        metadata: {
          totalCalls: 100,
          processedCalls: 100,
          enrichedCalls: 100,
          processingTimeMs: 50,
        },
        callerMetrics: {},
        systemMetrics: {},
        athDistribution: {},
      }),
    };

    mockCtx = {
      services: {
        analyticsEngine: () => mockAnalyticsEngine as any,
      },
    } as unknown as CommandContext;
  });

  it('should return metrics data', async () => {
    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      format: 'table' as const,
    };

    const result = await metricsAnalyticsHandler(args, mockCtx);

    expect(mockAnalyticsEngine.analyzeCalls).toHaveBeenCalledWith({
      callerNames: undefined,
      from: undefined,
      to: undefined,
      enrichWithAth: true,
    });

    expect(result).toHaveProperty('totalCalls');
    expect(result).toHaveProperty('processedCalls');
    expect(result).toHaveProperty('enrichedCalls');
    expect(result).toHaveProperty('processingTimeMs');
    expect(result).toHaveProperty('callerMetrics');
    expect(result).toHaveProperty('systemMetrics');
    expect(result).toHaveProperty('athDistribution');
  });
});
