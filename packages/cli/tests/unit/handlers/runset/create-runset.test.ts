/**
 * Create RunSet Handler Tests
 *
 * Tests for create-runset handler following CLI handler pattern.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRunsetHandler } from '../../../../src/handlers/runset/create-runset.js';
import type { RunSetResolverPort, RunSetWithResolution, RunSetSpec } from '@quantbot/core';
import type { CommandContext } from '../../../../src/core/command-context.js';

describe('createRunsetHandler', () => {
  let mockResolver: RunSetResolverPort;
  let mockContext: CommandContext;

  beforeEach(() => {
    mockResolver = {
      createRunSet: vi.fn().mockImplementation(async (request) => {
        const runset: RunSetWithResolution = {
          spec: request.spec,
          resolution: request.autoResolve
            ? {
                runsetId: request.spec.runsetId,
                resolverVersion: '1.0.0',
                resolvedAt: new Date().toISOString(),
                runIds: ['run-1', 'run-2'],
                artifacts: [],
                contentHash: 'abc123',
                metadata: { runCount: 2, artifactCount: 0 },
                frozen: false,
              }
            : undefined,
          mode: 'exploration',
        };
        return runset;
      }),
      getRunSet: vi.fn(),
      queryRunSets: vi.fn(),
      resolveRunSet: vi.fn(),
      freezeRunSet: vi.fn(),
      unfreezeRunSet: vi.fn(),
      deleteRunSet: vi.fn(),
      registerDataset: vi.fn(),
      getDataset: vi.fn(),
      listDatasets: vi.fn(),
      registerRun: vi.fn(),
      getRun: vi.fn(),
      listRuns: vi.fn(),
      getResolutionHistory: vi.fn(),
      validateSpec: vi.fn(),
      isAvailable: vi.fn(),
    };

    mockContext = {
      services: {
        runsetResolver: () => mockResolver,
      },
    } as unknown as CommandContext;
  });

  it('should create RunSet with required fields', async () => {
    const result = await createRunsetHandler(
      {
        id: 'brook_baseline_2025Q4',
        name: 'Brook Baseline Q4 2025',
        dataset: 'ohlcv_v2_2025Q4',
        from: '2025-10-01',
        to: '2025-12-31',
      },
      mockContext
    );

    expect(result.runset.spec.runsetId).toBe('brook_baseline_2025Q4');
    expect(result.runset.spec.name).toBe('Brook Baseline Q4 2025');
    expect(result.runset.spec.datasetId).toBe('ohlcv_v2_2025Q4');
    expect(result.runset.mode).toBe('exploration');
    expect(result.message).toContain('created');

    expect(mockResolver.createRunSet).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          runsetId: 'brook_baseline_2025Q4',
          name: 'Brook Baseline Q4 2025',
          datasetId: 'ohlcv_v2_2025Q4',
        }),
      })
    );
  });

  it('should create RunSet with universe filters', async () => {
    const result = await createRunsetHandler(
      {
        id: 'test_runset',
        name: 'Test RunSet',
        dataset: 'ohlcv_v2_2025Q4',
        caller: 'whale_watcher',
        chain: 'solana',
        venue: 'raydium',
        minMarketCap: 1000000,
        maxMarketCap: 10000000,
        minVolume: 500000,
        from: '2025-10-01',
        to: '2025-12-31',
      },
      mockContext
    );

    expect(mockResolver.createRunSet).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          universe: expect.objectContaining({
            callers: ['whale_watcher'],
            chains: ['solana'],
            venues: ['raydium'],
            minMarketCap: 1000000,
            maxMarketCap: 10000000,
            minVolume: 500000,
          }),
        }),
      })
    );
  });

  it('should create RunSet with strategy filters', async () => {
    const result = await createRunsetHandler(
      {
        id: 'test_runset',
        name: 'Test RunSet',
        dataset: 'ohlcv_v2_2025Q4',
        from: '2025-10-01',
        to: '2025-12-31',
        strategyFamily: 'MultiTrade_20pctTrail',
        engineVersion: '1.0.0',
      },
      mockContext
    );

    expect(mockResolver.createRunSet).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          strategy: expect.objectContaining({
            strategyFamily: 'MultiTrade_20pctTrail',
            engineVersion: '1.0.0',
          }),
        }),
      })
    );
  });

  it('should auto-resolve if requested', async () => {
    const result = await createRunsetHandler(
      {
        id: 'test_runset',
        name: 'Test RunSet',
        dataset: 'ohlcv_v2_2025Q4',
        from: '2025-10-01',
        to: '2025-12-31',
        autoResolve: true,
      },
      mockContext
    );

    expect(result.runset.resolution).toBeDefined();
    expect(result.runset.resolution?.runIds).toEqual(['run-1', 'run-2']);
    expect(result.message).toContain('resolved');

    expect(mockResolver.createRunSet).toHaveBeenCalledWith({
      spec: expect.any(Object),
      autoResolve: true,
    });
  });

  it('should include tags if provided', async () => {
    const result = await createRunsetHandler(
      {
        id: 'test_runset',
        name: 'Test RunSet',
        dataset: 'ohlcv_v2_2025Q4',
        from: '2025-10-01',
        to: '2025-12-31',
        tags: ['baseline', 'q4', 'paper_fig_2'],
      },
      mockContext
    );

    expect(mockResolver.createRunSet).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          tags: ['baseline', 'q4', 'paper_fig_2'],
        }),
      })
    );
  });

  it('should propagate errors from resolver', async () => {
    const error = new Error('Registry not available');
    vi.mocked(mockResolver.createRunSet).mockRejectedValue(error);

    await expect(
      createRunsetHandler(
        {
          id: 'test_runset',
          name: 'Test RunSet',
          dataset: 'ohlcv_v2_2025Q4',
          from: '2025-10-01',
          to: '2025-12-31',
        },
        mockContext
      )
    ).rejects.toThrow('Registry not available');
  });

  // Isolation test
  it('should be callable with plain objects', async () => {
    const plainContext = {
      services: {
        runsetResolver: () => ({
          createRunSet: async (request: any) => ({
            spec: request.spec,
            mode: 'exploration',
          }),
        }),
      },
    };

    const result = await createRunsetHandler(
      {
        id: 'test_runset',
        name: 'Test RunSet',
        dataset: 'ohlcv_v2_2025Q4',
        from: '2025-10-01',
        to: '2025-12-31',
      },
      plainContext as CommandContext
    );

    expect(result.runset.spec.runsetId).toBe('test_runset');
  });
});

