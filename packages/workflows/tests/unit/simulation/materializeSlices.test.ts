/**
 * Unit tests for materializeSlices service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { materializeSlices, loadSlice } from '../../../src/simulation/materializeSlices.js';
import type { RunPlan } from '../../../src/simulation/planRun.js';
import type { WorkflowContext } from '../../../src/types.js';
import { getStorageEngine } from '@quantbot/storage';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock storage engine
vi.mock('@quantbot/storage', () => ({
  getStorageEngine: vi.fn(),
}));

// Mock getArtifactsDir
vi.mock('@quantbot/core', () => ({
  getArtifactsDir: vi.fn(() => tmpdir()),
}));

describe('materializeSlices', () => {
  const mockCtx: WorkflowContext = {
    clock: { nowISO: () => DateTime.utc().toISO()! },
    ids: { newRunId: () => 'test-run' },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
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
    ],
  };

  const mockStorageEngine = {
    getCandles: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStorageEngine).mockReturnValue(mockStorageEngine as any);
  });

  it('should materialize slices for eligible tokens', async () => {
    const mockCandles = [
      {
        timestamp: Math.floor(DateTime.fromISO('2024-01-01T11:00:00Z').toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.0,
        volume: 1000,
      },
      {
        timestamp: Math.floor(DateTime.fromISO('2024-01-01T11:05:00Z').toSeconds()),
        open: 1.0,
        high: 1.2,
        low: 0.95,
        close: 1.1,
        volume: 1200,
      },
    ];

    mockStorageEngine.getCandles.mockResolvedValue(mockCandles);

    const result = await materializeSlices(mockPlan, ['token1'], mockCtx, 'test-run');

    expect(result.slicePaths.size).toBe(1);
    expect(result.slicePaths.has('token1')).toBe(true);
    expect(result.sliceMetadata.length).toBe(1);
    expect(result.sliceMetadata[0]?.token).toBe('token1');
    expect(result.sliceMetadata[0]?.candleCount).toBe(2);
  });

  it('should handle tokens with no candles', async () => {
    mockStorageEngine.getCandles.mockResolvedValue([]);

    const result = await materializeSlices(mockPlan, ['token1'], mockCtx, 'test-run');

    expect(result.slicePaths.size).toBe(0);
    expect(mockCtx.logger.warn).toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    mockStorageEngine.getCandles.mockRejectedValue(new Error('Connection failed'));

    const result = await materializeSlices(mockPlan, ['token1'], mockCtx, 'test-run');

    expect(result.slicePaths.size).toBe(0);
    expect(mockCtx.logger.error).toHaveBeenCalled();
  });
});

describe('loadSlice', () => {
  it('should load candles from slice file', async () => {
    const testCandles = [
      { ts: '2024-01-01T00:00:00Z', o: 1.0, h: 1.1, l: 0.9, c: 1.0, v: 1000 },
      { ts: '2024-01-01T00:05:00Z', o: 1.0, h: 1.2, l: 0.95, c: 1.1, v: 1200 },
    ];

    const slicePath = join(tmpdir(), `test-slice-${Date.now()}.json`);
    await import('fs/promises').then(({ writeFile }) =>
      writeFile(slicePath, JSON.stringify(testCandles), 'utf8')
    );

    try {
      const loaded = await loadSlice(slicePath);
      expect(loaded).toEqual(testCandles);
    } finally {
      await unlink(slicePath).catch(() => {});
    }
  });
});
