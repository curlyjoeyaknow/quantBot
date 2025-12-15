/**
 * Tests for IndicatorsRepository
 *
 * Tests cover:
 * - Indicator storage (upsertIndicators)
 * - Indicator retrieval (getIndicators)
 * - Mint address preservation (CRITICAL)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { IndicatorsRepository } from '../../src/clickhouse/repositories/IndicatorsRepository';
import type { IndicatorValue } from '../../src/clickhouse/repositories/IndicatorsRepository';

// Mock ClickHouse client
const mockClickHouseClient = {
  insert: vi.fn(),
  query: vi.fn(),
  exec: vi.fn(),
};

vi.mock('../../src/clickhouse-client', () => ({
  getClickHouseClient: () => mockClickHouseClient,
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('IndicatorsRepository', () => {
  let repository: IndicatorsRepository;
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new IndicatorsRepository();
    mockClickHouseClient.exec.mockResolvedValue(undefined);
    mockClickHouseClient.insert.mockResolvedValue(undefined);
    mockClickHouseClient.query.mockResolvedValue({
      json: () => Promise.resolve([]),
    });
  });

  describe('upsertIndicators', () => {
    const mockIndicators: IndicatorValue[] = [
      {
        indicatorType: 'ichimoku',
        value: { tenkan: 0.001, kijun: 0.0012, senkouA: 0.0011, senkouB: 0.0013 },
        timestamp: 1000,
      },
    ];

    it('should store indicators with full mint address preserved', async () => {
      await repository.upsertIndicators(FULL_MINT, 'solana', 1000, mockIndicators);

      expect(mockClickHouseClient.insert).toHaveBeenCalled();
      const insertCall = mockClickHouseClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].token_address).toBe(FULL_MINT); // Full address, exact case
    });

    it('should preserve exact case of mint address', async () => {
      await repository.upsertIndicators(FULL_MINT_LOWERCASE, 'solana', 1000, mockIndicators);

      const insertCall = mockClickHouseClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].token_address).toBe(FULL_MINT_LOWERCASE); // Exact case preserved
    });

    it('should skip empty indicator arrays', async () => {
      await repository.upsertIndicators(FULL_MINT, 'solana', 1000, []);

      expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
    });

    it('should format indicators correctly for ClickHouse', async () => {
      await repository.upsertIndicators(FULL_MINT, 'solana', 1000, mockIndicators);

      const insertCall = mockClickHouseClient.insert.mock.calls[0][0];
      expect(insertCall.table).toContain('indicator_values');
      expect(insertCall.format).toBe('JSONEachRow');
      expect(insertCall.values[0]).toMatchObject({
        token_address: FULL_MINT,
        chain: 'solana',
        indicator_type: 'ichimoku',
      });
      expect(insertCall.values[0].value_json).toBeDefined();
    });

    it('should handle metadata', async () => {
      const indicatorsWithMetadata: IndicatorValue[] = [
        {
          indicatorType: 'ema',
          value: 1.05,
          timestamp: 1000,
          metadata: { period: 20 },
        },
      ];

      await repository.upsertIndicators(FULL_MINT, 'solana', 1000, indicatorsWithMetadata);

      const insertCall = mockClickHouseClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].metadata_json).toBe('{"period":20}');
    });

    it('should handle errors', async () => {
      mockClickHouseClient.insert.mockRejectedValue(new Error('Database error'));

      await expect(
        repository.upsertIndicators(FULL_MINT, 'solana', 1000, mockIndicators)
      ).rejects.toThrow('Database error');
    });
  });

  describe('getIndicators', () => {
    const startTime = DateTime.fromISO('2024-01-01T00:00:00Z');
    const endTime = DateTime.fromISO('2024-01-02T00:00:00Z');

    it('should retrieve indicators with full mint address', async () => {
      const mockResponse = {
        json: () =>
          Promise.resolve([
            {
              timestamp: 1000,
              indicator_type: 'ichimoku',
              value_json: '{"tenkan":0.001,"kijun":0.0012}',
              metadata_json: '{}',
            },
          ]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      const result = await repository.getIndicators(FULL_MINT, 'solana', startTime, endTime);

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      const queryCall = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT); // Full address in query
      expect(result).toBeInstanceOf(Map);
    });

    it('should preserve exact case in queries', async () => {
      const mockResponse = {
        json: () => Promise.resolve([]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      await repository.getIndicators(FULL_MINT_LOWERCASE, 'solana', startTime, endTime);

      const queryCall = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT_LOWERCASE); // Exact case in query
    });

    it('should filter by indicator types when provided', async () => {
      const mockResponse = {
        json: () => Promise.resolve([]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      await repository.getIndicators(FULL_MINT, 'solana', startTime, endTime, ['ichimoku', 'ema']);

      const queryCall = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain('ichimoku');
      expect(queryCall.query).toContain('ema');
    });

    it('should return empty map when no indicators found', async () => {
      const mockResponse = {
        json: () => Promise.resolve([]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      const result = await repository.getIndicators(FULL_MINT, 'solana', startTime, endTime);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('should parse indicator values correctly', async () => {
      const mockResponse = {
        json: () =>
          Promise.resolve([
            {
              timestamp: 1000,
              indicator_type: 'ichimoku',
              value_json: '{"tenkan":0.001,"kijun":0.0012}',
              metadata_json: '{}',
            },
          ]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      const result = await repository.getIndicators(FULL_MINT, 'solana', startTime, endTime);

      expect(result.size).toBe(1);
      const indicators = result.get(1000);
      expect(indicators).toBeDefined();
      expect(indicators![0].indicatorType).toBe('ichimoku');
      expect(indicators![0].value).toEqual({ tenkan: 0.001, kijun: 0.0012 });
    });
  });

  describe('getLatestIndicators', () => {
    it('should retrieve latest indicators', async () => {
      const mockResponse = {
        json: () =>
          Promise.resolve([
            {
              timestamp: 1000,
              indicator_type: 'ichimoku',
              value_json: '{"tenkan":0.001}',
              metadata_json: '{}',
            },
          ]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      const result = await repository.getLatestIndicators(FULL_MINT, 'solana');

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should preserve exact case of mint address', async () => {
      const mockResponse = {
        json: () => Promise.resolve([]),
      };
      mockClickHouseClient.query.mockResolvedValue(mockResponse);

      await repository.getLatestIndicators(FULL_MINT_LOWERCASE, 'solana');

      const queryCall = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT_LOWERCASE);
    });
  });
});
