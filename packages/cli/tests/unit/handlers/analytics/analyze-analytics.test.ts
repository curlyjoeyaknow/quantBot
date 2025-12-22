/**
 * Unit tests for analyzeAnalyticsHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
 */

import { describe, it, expect, vi } from 'vitest';
import { analyzeAnalyticsHandler } from '../../../../src/handlers/analytics/analyze-analytics.js';

describe('analyzeAnalyticsHandler', () => {
  it('calls AnalyticsEngine.analyzeCalls with converted dates and caller filter', async () => {
    const mockResult = {
      calls: [],
      callerMetrics: [],
      athDistribution: [],
      systemMetrics: {
        totalCalls: 0,
        totalCallers: 0,
        dateRange: { from: new Date(), to: new Date() },
      },
      dashboard: {
        system: {
          totalCalls: 0,
          totalCallers: 0,
          dateRange: { from: new Date(), to: new Date() },
        },
        topCallers: [],
        athDistribution: [],
        recentCalls: [],
        generatedAt: new Date(),
      },
      metadata: {
        totalCalls: 0,
        processedCalls: 0,
        enrichedCalls: 0,
        processingTimeMs: 100,
      },
    };

    const analyzeCalls = vi.fn().mockResolvedValue(mockResult);

    const fakeCtx = {
      services: {
        analyticsEngine: () => ({ analyzeCalls }),
      },
    } as any;

    const args = {
      caller: 'Brook',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-02-01T00:00:00.000Z',
      format: 'json' as const,
    };

    const result = await analyzeAnalyticsHandler(args, fakeCtx);

    expect(analyzeCalls).toHaveBeenCalledTimes(1);
    const callArg = analyzeCalls.mock.calls[0][0];

    expect(callArg.callerNames).toEqual(['Brook']);
    expect(callArg.from).toBeInstanceOf(Date);
    expect(callArg.to).toBeInstanceOf(Date);
    expect(callArg.from.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(callArg.to.toISOString()).toBe('2024-02-01T00:00:00.000Z');

    expect(result).toEqual(mockResult);
  });

  it('handles optional caller parameter', async () => {
    const analyzeCalls = vi.fn().mockResolvedValue({
      calls: [],
      callerMetrics: [],
      athDistribution: [],
      systemMetrics: {
        totalCalls: 10,
        totalCallers: 2,
        dateRange: { from: new Date(), to: new Date() },
      },
      dashboard: {
        system: {
          totalCalls: 10,
          totalCallers: 2,
          dateRange: { from: new Date(), to: new Date() },
        },
        topCallers: [],
        athDistribution: [],
        recentCalls: [],
        generatedAt: new Date(),
      },
      metadata: {
        totalCalls: 10,
        processedCalls: 10,
        enrichedCalls: 0,
        processingTimeMs: 50,
      },
    });

    const fakeCtx = {
      services: {
        analyticsEngine: () => ({ analyzeCalls }),
      },
    } as any;

    const args = {
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-02-01T00:00:00.000Z',
      format: 'table' as const,
    };

    await analyzeAnalyticsHandler(args, fakeCtx);

    const callArg = analyzeCalls.mock.calls[0][0];
    expect(callArg.callerNames).toBeUndefined();
    expect(callArg.from).toBeInstanceOf(Date);
    expect(callArg.to).toBeInstanceOf(Date);
  });

  it('handles optional date parameters', async () => {
    const analyzeCalls = vi.fn().mockResolvedValue({
      calls: [],
      callerMetrics: [],
      athDistribution: [],
      systemMetrics: {
        totalCalls: 5,
        totalCallers: 1,
        dateRange: { from: new Date(), to: new Date() },
      },
      dashboard: {
        system: {
          totalCalls: 5,
          totalCallers: 1,
          dateRange: { from: new Date(), to: new Date() },
        },
        topCallers: [],
        athDistribution: [],
        recentCalls: [],
        generatedAt: new Date(),
      },
      metadata: {
        totalCalls: 5,
        processedCalls: 5,
        enrichedCalls: 0,
        processingTimeMs: 25,
      },
    });

    const fakeCtx = {
      services: {
        analyticsEngine: () => ({ analyzeCalls }),
      },
    } as any;

    const args = {
      caller: 'Lsy',
      format: 'json' as const,
    };

    await analyzeAnalyticsHandler(args, fakeCtx);

    const callArg = analyzeCalls.mock.calls[0][0];
    expect(callArg.callerNames).toEqual(['Lsy']);
    expect(callArg.from).toBeUndefined();
    expect(callArg.to).toBeUndefined();
  });

  it('propagates engine errors without catching them', async () => {
    const engineError = new Error('Analytics engine failed: database connection lost');
    const analyzeCalls = vi.fn().mockRejectedValue(engineError);

    const fakeCtx = {
      services: {
        analyticsEngine: () => ({ analyzeCalls }),
      },
    } as any;

    const args = {
      caller: 'Brook',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-02-01T00:00:00.000Z',
      format: 'json' as const,
    };

    // Handler should let errors bubble up (no try/catch)
    await expect(analyzeAnalyticsHandler(args, fakeCtx)).rejects.toThrow(
      'Analytics engine failed: database connection lost'
    );
    expect(analyzeCalls).toHaveBeenCalledTimes(1);
  });
});
