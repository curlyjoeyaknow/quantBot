/**
 * Unit tests for coveragePreflight service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { coveragePreflight } from '../../../src/simulation/coveragePreflight.js';
import type { RunPlan } from '../../../src/simulation/planRun.js';
import type { WorkflowContext } from '../../../src/types.js';
import * as ohlcv from '@quantbot/ohlcv';

// Mock getCoverage
vi.mock('@quantbot/ohlcv', () => ({
  getCoverage: vi.fn(),
}));

describe('coveragePreflight', () => {
  const mockCtx: WorkflowContext = {
    clock: { nowISO: () => DateTime.utc().toISO()! },
    ids: { newRunId: () => 'test-run' },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    repos: {
      strategies: { getByName: vi.fn() },
      calls: { list: vi.fn() },
      simulationRuns: { create: vi.fn() },
      simulationResults: { insertMany: vi.fn() },
    },
    ohlcv: {
      causalAccessor: {} as any,
    },
    simulation: {
      run: vi.fn(),
    },
  };

  const mockPlan: RunPlan = {
    requiredWarmupCandles: 15,
    requiredLookback: 15,
    requiredDelay: 0,
    maxHoldingCandles: 1000,
    interval: '5m',
    tokenRequirements: [
      {
        token: 'token1',
        alertTime: DateTime.fromISO('2024-01-01T12:00:00Z'),
        requiredFromTs: DateTime.fromISO('2024-01-01T11:00:00Z'),
        requiredToTs: DateTime.fromISO('2024-01-02T12:00:00Z'),
        requiredCandleCount: 300,
      },
      {
        token: 'token2',
        alertTime: DateTime.fromISO('2024-01-01T13:00:00Z'),
        requiredFromTs: DateTime.fromISO('2024-01-01T12:00:00Z'),
        requiredToTs: DateTime.fromISO('2024-01-02T13:00:00Z'),
        requiredCandleCount: 300,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mark tokens as eligible when coverage is sufficient', async () => {
    vi.mocked(ohlcv.getCoverage).mockResolvedValue({
      hasData: true,
      candleCount: 500,
      coverageRatio: 0.95,
      gaps: [],
    });

    const result = await coveragePreflight(mockPlan, mockCtx);

    expect(result.eligibleTokens.length).toBe(2);
    expect(result.excludedTokens.length).toBe(0);
    expect(result.coverageSummary.eligible).toBe(2);
  });

  it('should exclude tokens with insufficient candles', async () => {
    vi.mocked(ohlcv.getCoverage)
      .mockResolvedValueOnce({
        hasData: true,
        candleCount: 500,
        coverageRatio: 0.95,
        gaps: [],
      })
      .mockResolvedValueOnce({
        hasData: true,
        candleCount: 100, // Below required 300
        coverageRatio: 0.5,
        gaps: [],
      });

    const result = await coveragePreflight(mockPlan, mockCtx);

    expect(result.eligibleTokens.length).toBe(1);
    expect(result.excludedTokens.length).toBe(1);
    expect(result.excludedTokens[0]?.reason).toBe('insufficient');
  });

  it('should exclude tokens with low coverage ratio', async () => {
    vi.mocked(ohlcv.getCoverage).mockResolvedValue({
      hasData: true,
      candleCount: 500,
      coverageRatio: 0.5, // Below 0.8 threshold
      gaps: [],
    });

    const result = await coveragePreflight(mockPlan, mockCtx);

    expect(result.eligibleTokens.length).toBe(0);
    expect(result.excludedTokens.length).toBe(2);
    expect(result.excludedTokens[0]?.reason).toBe('insufficient');
  });

  it('should exclude tokens with no data', async () => {
    vi.mocked(ohlcv.getCoverage).mockResolvedValue({
      hasData: false,
      candleCount: 0,
      coverageRatio: 0,
      gaps: [{ start: new Date(), end: new Date() }],
    });

    const result = await coveragePreflight(mockPlan, mockCtx);

    expect(result.eligibleTokens.length).toBe(0);
    expect(result.excludedTokens.length).toBe(2);
    expect(result.excludedTokens[0]?.reason).toBe('no_data');
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(ohlcv.getCoverage).mockRejectedValue(new Error('Connection failed'));

    const result = await coveragePreflight(mockPlan, mockCtx);

    expect(result.eligibleTokens.length).toBe(0);
    expect(result.excludedTokens.length).toBe(2);
    expect(result.excludedTokens[0]?.reason).toBe('no_data');
  });
});
