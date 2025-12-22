import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reportAnalyticsHandler } from '../../../../src/handlers/analytics/report-analytics.js';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('reportAnalyticsHandler', () => {
  let mockCtx: CommandContext;
  let mockAnalyticsEngine: {
    analyzeCalls: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyticsEngine = {
      analyzeCalls: vi.fn().mockResolvedValue({
        dashboard: {
          generatedAt: '2024-01-01T00:00:00Z',
          system: { totalCalls: 100 },
          topCallers: [],
          athDistribution: {},
          recentCalls: [],
        },
        metadata: {
          totalCalls: 100,
          processedCalls: 100,
          enrichedCalls: 100,
          processingTimeMs: 50,
        },
      }),
    };

    mockCtx = {
      services: {
        analyticsEngine: () => mockAnalyticsEngine as any,
      },
    } as unknown as CommandContext;
  });

  it('should return analytics report data', async () => {
    const args = {
      caller: undefined,
      from: undefined,
      to: undefined,
      format: 'table' as const,
    };

    const result = await reportAnalyticsHandler(args, mockCtx);

    expect(mockAnalyticsEngine.analyzeCalls).toHaveBeenCalledWith({
      callerNames: undefined,
      from: undefined,
      to: undefined,
      enrichWithAth: true,
    });

    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('system');
    expect(result).toHaveProperty('topCallers');
    expect(result).toHaveProperty('athDistribution');
    expect(result).toHaveProperty('recentCallsCount');
    expect(result).toHaveProperty('metadata');
  });
});
