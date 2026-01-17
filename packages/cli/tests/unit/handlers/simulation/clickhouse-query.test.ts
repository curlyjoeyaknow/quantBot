/**
 * Unit tests for clickhouse-query handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clickHouseQueryHandler } from '../../../../src/commands/simulation/clickhouse-query.js';
import type { CommandContext } from '../../../../src/core/command-context.js';
import { ValidationError } from '@quantbot/infra/utils';

describe('clickHouseQueryHandler', () => {
  let mockClickHouseService: any;
  let mockCtx: CommandContext;

  beforeEach(() => {
    mockClickHouseService = {
      queryOHLCV: vi.fn(),
      storeEvents: vi.fn(),
      aggregateMetrics: vi.fn(),
    };

    mockCtx = {
      services: {
        clickHouse: () => mockClickHouseService,
      },
    } as unknown as CommandContext;
  });

  it('should query OHLCV data', async () => {
    const mockResult = {
      success: true,
      candles: [],
      count: 0,
    };
    vi.mocked(mockClickHouseService.queryOHLCV).mockResolvedValue(mockResult);

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

    expect(mockClickHouseService.queryOHLCV).toHaveBeenCalledWith(
      'So11111111111111111111111111111111111111112',
      'solana',
      '2024-01-01T00:00:00Z',
      '2024-01-02T00:00:00Z',
      '5m'
    );
    expect(result).toEqual(mockResult);
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

    const mockResult = {
      success: true,
      stored_count: 1,
    };
    vi.mocked(mockClickHouseService.storeEvents).mockResolvedValue(mockResult);

    const args = {
      operation: 'store_events' as const,
      runId: 'run123',
      events,
      format: 'table' as const,
    };

    const result = await clickHouseQueryHandler(args, mockCtx);

    expect(mockClickHouseService.storeEvents).toHaveBeenCalledWith('run123', events);
    expect(result).toEqual(mockResult);
  });

  it('should aggregate metrics', async () => {
    const mockResult = {
      success: true,
      metrics: {
        event_count: 10,
        total_pnl: 100.0,
        avg_pnl: 10.0,
      },
    };
    vi.mocked(mockClickHouseService.aggregateMetrics).mockResolvedValue(mockResult);

    const args = {
      operation: 'aggregate_metrics' as const,
      runId: 'run123',
      format: 'table' as const,
    };

    const result = await clickHouseQueryHandler(args, mockCtx);

    expect(mockClickHouseService.aggregateMetrics).toHaveBeenCalledWith('run123');
    expect(result).toEqual(mockResult);
  });

  it('should throw ValidationError for missing required fields in query_ohlcv', async () => {
    const args = {
      operation: 'query_ohlcv' as const,
      format: 'table' as const,
    };

    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow(
      'tokenAddress, chain, startTime, and endTime are required'
    );
  });

  it('should throw ValidationError for missing required fields in store_events', async () => {
    const args = {
      operation: 'store_events' as const,
      format: 'table' as const,
    };

    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow(
      'runId and events are required'
    );
  });

  it('should throw ValidationError for missing required fields in aggregate_metrics', async () => {
    const args = {
      operation: 'aggregate_metrics' as const,
      format: 'table' as const,
    };

    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow(ValidationError);
    await expect(clickHouseQueryHandler(args, mockCtx)).rejects.toThrow('runId is required');
  });
});
