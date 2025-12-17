/**
 * Unit tests for clickhouse-query handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clickHouseQueryHandler } from '../../../../src/handlers/simulation/clickhouse-query.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import type { PythonEngine } from '@quantbot/utils';

describe('clickHouseQueryHandler', () => {
  let mockEngine: PythonEngine;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockEngine = {
      runClickHouseEngine: vi.fn(),
    } as unknown as PythonEngine;

    mockCtx = {
      services: {
        pythonEngine: () => mockEngine,
      },
    } as unknown as CommandContext;
  });

  it('should query OHLCV data', async () => {
    vi.mocked(mockEngine.runClickHouseEngine).mockResolvedValue({
      success: true,
      candles: [],
      count: 0,
    });

    const args = {
      operation: 'query_ohlcv' as const,
      tokenAddress: 'So11111111111111111111111111111111111111112',
      chain: 'solana',
      startTime: '2024-01-01T00:00:00Z',
      endTime: '2024-01-02T00:00:00Z',
      interval: '5m' as const,
      format: 'table' as const,
    };

    const result = await clickHouseQueryHandler(args, mockCtx);

    expect(mockEngine.runClickHouseEngine).toHaveBeenCalledWith(
      {
        operation: 'query_ohlcv',
        data: {
          token_address: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          start_time: '2024-01-01T00:00:00Z',
          end_time: '2024-01-02T00:00:00Z',
          interval: '5m',
        },
      },
      expect.objectContaining({
        env: expect.objectContaining({
          CLICKHOUSE_HOST: 'localhost',
        }),
      })
    );
    expect(result.success).toBe(true);
  });

  it('should store simulation events', async () => {
    const events = [
      {
        event_type: 'entry',
        timestamp: 1704067200,
        price: 1.0,
        quantity: 100,
        value_usd: 100,
        pnl_usd: 0,
      },
    ];

    vi.mocked(mockEngine.runClickHouseEngine).mockResolvedValue({
      success: true,
      stored_count: 1,
    });

    const args = {
      operation: 'store_events' as const,
      runId: 'run123',
      events,
      format: 'table' as const,
    };

    const result = await clickHouseQueryHandler(args, mockCtx);

    expect(mockEngine.runClickHouseEngine).toHaveBeenCalledWith(
      {
        operation: 'store_events',
        data: {
          run_id: 'run123',
          events,
        },
      },
      expect.any(Object)
    );
    expect(result.success).toBe(true);
  });

  it('should aggregate metrics', async () => {
    vi.mocked(mockEngine.runClickHouseEngine).mockResolvedValue({
      success: true,
      metrics: {
        event_count: 10,
        total_pnl: 100.0,
        avg_pnl: 10.0,
      },
    });

    const args = {
      operation: 'aggregate_metrics' as const,
      runId: 'run123',
      format: 'table' as const,
    };

    const result = await clickHouseQueryHandler(args, mockCtx);

    expect(mockEngine.runClickHouseEngine).toHaveBeenCalledWith(
      {
        operation: 'aggregate_metrics',
        data: {
          run_id: 'run123',
        },
      },
      expect.any(Object)
    );
    expect(result.success).toBe(true);
  });

  it('should validate required fields for query_ohlcv', async () => {
    const args = {
      operation: 'query_ohlcv' as const,
      format: 'table' as const,
    };

    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow();
  });

  it('should validate required fields for store_events', async () => {
    const args = {
      operation: 'store_events' as const,
      format: 'table' as const,
    };

    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow();
  });

  it('should validate required fields for aggregate_metrics', async () => {
    const args = {
      operation: 'aggregate_metrics' as const,
      format: 'table' as const,
    };

    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow();
  });
});
