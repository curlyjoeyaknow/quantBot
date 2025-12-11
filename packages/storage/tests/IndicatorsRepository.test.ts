/**
 * Tests for IndicatorsRepository
 * 
 * Tests cover:
 * - Indicator storage with mint address preservation
 * - Indicator retrieval
 * - Latest indicators
 * - Cleanup operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { IndicatorsRepository } from '../src/clickhouse/repositories/IndicatorsRepository';
import { getClickHouseClient } from '../src/clickhouse-client';

vi.mock('../src/clickhouse-client', () => ({
  getClickHouseClient: vi.fn(),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('IndicatorsRepository', () => {
  let repo: IndicatorsRepository;
  let mockClient: any;

  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      exec: vi.fn().mockResolvedValue(undefined),
      insert: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      }),
    };

    vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);
    repo = new IndicatorsRepository();
  });

  describe('upsertIndicators', () => {
    it('should preserve full mint address and exact case', async () => {
      const indicators = [
        {
          indicatorType: 'ichimoku',
          value: { tenkan: 0.001, kijun: 0.0012 },
          timestamp: 1000,
        },
      ];

      await repo.upsertIndicators(FULL_MINT, 'solana', 1000, indicators);

      expect(mockClient.insert).toHaveBeenCalled();
      const insertCall = mockClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].token_address).toBe(FULL_MINT);
    });

    it('should preserve lowercase mint address', async () => {
      const indicators = [
        {
          indicatorType: 'ichimoku',
          value: { tenkan: 0.001 },
          timestamp: 1000,
        },
      ];

      await repo.upsertIndicators(FULL_MINT_LOWERCASE, 'solana', 1000, indicators);

      const insertCall = mockClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].token_address).toBe(FULL_MINT_LOWERCASE);
    });

    it('should handle empty indicators array', async () => {
      await repo.upsertIndicators(FULL_MINT, 'solana', 1000, []);
      expect(mockClient.insert).not.toHaveBeenCalled();
    });

    it('should serialize indicator values as JSON', async () => {
      const indicators = [
        {
          indicatorType: 'ichimoku',
          value: { tenkan: 0.001, kijun: 0.0012 },
          timestamp: 1000,
          metadata: { source: 'test' },
        },
      ];

      await repo.upsertIndicators(FULL_MINT, 'solana', 1000, indicators);

      const insertCall = mockClient.insert.mock.calls[0][0];
      const valueJson = JSON.parse(insertCall.values[0].value_json);
      expect(valueJson).toEqual({ tenkan: 0.001, kijun: 0.0012 });
    });
  });

  describe('getIndicators', () => {
    it('should preserve full mint address in queries', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);

      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await repo.getIndicators(FULL_MINT, 'solana', startTime, endTime);

      const queryCall = mockClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT);
    });

    it('should return indicators grouped by timestamp', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);

      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          {
            timestamp: 1000,
            indicator_type: 'ichimoku',
            value_json: JSON.stringify({ tenkan: 0.001 }),
            metadata_json: '{}',
          },
          {
            timestamp: 1000,
            indicator_type: 'ema',
            value_json: JSON.stringify({ ema9: 0.0011 }),
            metadata_json: '{}',
          },
        ]),
      });

      const result = await repo.getIndicators(FULL_MINT, 'solana', startTime, endTime);

      expect(result.size).toBe(1);
      expect(result.get(1000)?.length).toBe(2);
    });

    it('should filter by indicator types when provided', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);

      await repo.getIndicators(FULL_MINT, 'solana', startTime, endTime, ['ichimoku']);

      const queryCall = mockClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain("indicator_type IN ('ichimoku')");
    });
  });

  describe('getLatestIndicators', () => {
    it('should preserve full mint address', async () => {
      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await repo.getLatestIndicators(FULL_MINT, 'solana');

      const queryCall = mockClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT);
    });

    it('should return latest indicators', async () => {
      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          {
            timestamp: 2000,
            indicator_type: 'ichimoku',
            value_json: JSON.stringify({ tenkan: 0.001 }),
            metadata_json: '{}',
          },
        ]),
      });

      const result = await repo.getLatestIndicators(FULL_MINT, 'solana');

      expect(result.length).toBe(1);
      expect(result[0].indicatorType).toBe('ichimoku');
    });
  });
});

