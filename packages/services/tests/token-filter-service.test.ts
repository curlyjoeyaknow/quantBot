import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { TokenFilterService } from '../../src/services/token-filter-service';
import { tokenService } from '../../src/services/token-service';
import { getClickHouseClient } from '../../src/storage/clickhouse-client';

// Mock dependencies
vi.mock('../../src/services/token-service', () => ({
  tokenService: {
    listTokens: vi.fn(),
  },
}));

vi.mock('../../src/storage/clickhouse-client', () => ({
  getClickHouseClient: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock sqlite3
const mockDbInstance = {
  get: vi.fn(),
  close: vi.fn(),
};

vi.mock('sqlite3', () => {
  class MockDatabase {
    get = mockDbInstance.get;
    close = mockDbInstance.close;

    constructor(path: string, callback?: (err: Error | null) => void) {
      if (callback) {
        setTimeout(() => callback(null), 0);
      }
    }
  }

  return {
    Database: MockDatabase,
  };
});

describe('token-filter-service', () => {
  let service: TokenFilterService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TokenFilterService();
  });

  describe('filterTokens', () => {
    it('should filter by chain', async () => {
      const mockTokens = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
        },
        {
          mint: '0x123',
          chain: 'ethereum',
        },
      ];

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);

      const result = await service.filterTokens({ chain: 'solana' });

      expect(result.length).toBeGreaterThan(0);
      expect(tokenService.listTokens).toHaveBeenCalledWith({ chain: 'solana' });
    });

    it('should filter by hasCandleData', async () => {
      const mockTokens = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
        },
      ];

      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([{ count: 10 }]),
        }),
      };

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const result = await service.filterTokens({
        hasCandleData: true,
      });

      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should filter by volume range', async () => {
      const mockTokens = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
        },
      ];

      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([
            {
              avg_volume: 5000,
              avg_price: 1.0,
              last_candle_time: '2024-01-01T00:00:00Z',
            },
          ]),
        }),
      };

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const result = await service.filterTokens({
        volumeRange: { min: 1000, max: 10000 },
      });

      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should filter by price range', async () => {
      const mockTokens = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
        },
      ];

      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([
            {
              avg_volume: 1000,
              avg_price: 1.5,
              last_candle_time: '2024-01-01T00:00:00Z',
            },
          ]),
        }),
      };

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const result = await service.filterTokens({
        priceRange: { min: 1.0, max: 2.0 },
      });

      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should filter by caller', async () => {
      const mockTokens = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
        },
      ];

      mockDbInstance.get.mockImplementation((query, params, callback) => {
        callback(null, { count: 1 });
      });

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);

      const result = await service.filterTokens({
        caller: 'test-caller',
      });

      expect(mockDbInstance.get).toHaveBeenCalled();
    });

    it('should apply limit and offset', async () => {
      const mockTokens = Array(10).fill(null).map((_, i) => ({
        mint: `mint${i}`,
        chain: 'solana',
      }));

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);

      const result = await service.filterTokens({
        limit: 5,
        offset: 2,
      });

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should get tokens from ClickHouse when registry empty', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([
            { mint: 'So11111111111111111111111111111111111111112', chain: 'solana' },
          ]),
        }),
      };

      vi.mocked(tokenService.listTokens).mockResolvedValue([]);
      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const result = await service.filterTokens({
        hasCandleData: true,
      });

      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe('getTokenCount', () => {
    it('should return count of filtered tokens', async () => {
      const mockTokens = [
        { mint: 'mint1', chain: 'solana' },
        { mint: 'mint2', chain: 'solana' },
      ];

      vi.mocked(tokenService.listTokens).mockResolvedValue(mockTokens as any);

      const count = await service.getTokenCount({ chain: 'solana' });

      expect(count).toBe(2);
    });
  });
});

