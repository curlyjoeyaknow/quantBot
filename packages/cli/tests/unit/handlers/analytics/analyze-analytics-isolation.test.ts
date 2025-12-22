/**
 * Isolation Test - Litmus Test for analyzeAnalyticsHandler
 *
 * This test verifies the handler can be:
 * - Imported into a REPL
 * - Called with plain objects
 * - Returns deterministic results
 *
 * If this test passes, the handler is properly decoupled from CLI infrastructure.
 */

import { describe, it, expect, vi } from 'vitest';
import { analyzeAnalyticsHandler } from '../../../../src/handlers/analytics/analyze-analytics.js';

describe('analyzeAnalyticsHandler - Isolation Test', () => {
  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      caller: 'Brook',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-02-01T00:00:00.000Z',
      format: 'json' as const,
    };

    // Plain object context (minimal mock)
    const plainCtx = {
      services: {
        analyticsEngine: () => ({
          analyzeCalls: vi.fn().mockResolvedValue({
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
              processingTimeMs: 100,
            },
          }),
        }),
      },
    } as any;

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await analyzeAnalyticsHandler(plainArgs, plainCtx);

    // Deterministic result structure
    expect(result).toHaveProperty('calls');
    expect(result).toHaveProperty('callerMetrics');
    expect(result).toHaveProperty('athDistribution');
    expect(result).toHaveProperty('systemMetrics');
    expect(result).toHaveProperty('dashboard');
    expect(result).toHaveProperty('metadata');
  });

  it('returns the same result for the same inputs (deterministic)', async () => {
    const args1 = {
      caller: 'Lsy',
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-02-01T00:00:00.000Z',
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    const mockResult = {
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
        processingTimeMs: 50,
      },
    };

    const ctx1 = {
      services: {
        analyticsEngine: () => ({
          analyzeCalls: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const ctx2 = {
      services: {
        analyticsEngine: () => ({
          analyzeCalls: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const result1 = await analyzeAnalyticsHandler(args1, ctx1);
    const result2 = await analyzeAnalyticsHandler(args2, ctx2);

    // Results should have the same structure
    expect(Object.keys(result1)).toEqual(Object.keys(result2));
    expect(result1.metadata.totalCalls).toBe(result2.metadata.totalCalls);
  });
});
