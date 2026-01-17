/**
 * MarketDataIngestionService Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketDataIngestionService } from '../../src/market-data-ingestion-service.js';
import { BirdeyeClient } from '@quantbot/api-clients';
import { getClickHouseClient } from '@quantbot/storage';

// Mock dependencies
vi.mock('@quantbot/api-clients', () => ({
  BirdeyeClient: vi.fn(),
}));

vi.mock('@quantbot/storage', () => ({
  getClickHouseClient: vi.fn(),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getClickHouseDatabaseName: () => 'quantbot',
}));

describe('MarketDataIngestionService', () => {
  let mockBirdeyeClient: {
    searchMarkets: ReturnType<typeof vi.fn>;
    fetchTokenCreationInfo: ReturnType<typeof vi.fn>;
  };
  let mockClickHouseClient: {
    query: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockBirdeyeClient = {
      searchMarkets: vi.fn(),
      fetchTokenCreationInfo: vi.fn(),
    };

    mockClickHouseClient = {
      query: vi.fn(),
      insert: vi.fn(),
    };

    vi.mocked(getClickHouseClient).mockReturnValue(mockClickHouseClient as any);
  });

  describe('ingestForAllTokens', () => {
    it('should query tokens from ClickHouse', async () => {
      const mockTokens = ['token1', 'token2'];
      mockClickHouseClient.query.mockResolvedValue({
        json: async () => mockTokens.map((mint) => ({ mint })),
      });

      mockBirdeyeClient.searchMarkets.mockResolvedValue(null);
      mockBirdeyeClient.fetchTokenCreationInfo.mockResolvedValue(null);

      const service = new MarketDataIngestionService(mockBirdeyeClient as unknown as BirdeyeClient);
      await service.ingestForAllTokens({ chain: 'solana', limit: 10 });

      expect(mockClickHouseClient.query).toHaveBeenCalled();
      const queryCall = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain('ohlcv_candles');
      expect(queryCall.query_params).toEqual({ chain: 'solana' });
    });

    it('should fetch market data for each token', async () => {
      const mockTokens = ['token1'];
      mockClickHouseClient.query.mockResolvedValue({
        json: async () => mockTokens.map((mint) => ({ mint })),
      });

      const mockMarkets = [
        {
          name: 'Token-SOL',
          address: 'market1',
          network: 'solana',
          liquidity: 1000,
          unique_wallet_24h: 100,
          trade_24h: 50,
          trade_24h_change_percent: 10,
          volume_24h_usd: 5000,
          last_trade_unix_time: 1234567890,
          last_trade_human_time: '2024-01-01T00:00:00.000Z',
          amount_base: 100,
          amount_quote: 10,
          base_mint: 'token1',
          quote_mint: 'SOL',
          source: 'raydium',
          creation_time: '2024-01-01T00:00:00.000Z',
          is_scaled_ui_token_base: false,
          multiplier_base: null,
          is_scaled_ui_token_quote: false,
          multiplier_quote: null,
        },
      ];

      mockBirdeyeClient.searchMarkets.mockResolvedValue(mockMarkets);
      mockBirdeyeClient.fetchTokenCreationInfo.mockResolvedValue(null);
      mockClickHouseClient.insert.mockResolvedValue(undefined);

      const service = new MarketDataIngestionService(mockBirdeyeClient as unknown as BirdeyeClient);
      const result = await service.ingestForAllTokens({ chain: 'solana', limit: 1 });

      expect(mockBirdeyeClient.searchMarkets).toHaveBeenCalledWith('token1', 'all');
      expect(mockClickHouseClient.insert).toHaveBeenCalled();
      expect(result.marketsInserted).toBe(1);
    });

    it('should fetch token creation info for Solana tokens', async () => {
      // Use a valid Solana address format (base58, 32-44 chars)
      const validSolanaToken = 'So11111111111111111111111111111111111111112';
      const mockTokens = [validSolanaToken];
      mockClickHouseClient.query.mockResolvedValue({
        json: async () => mockTokens.map((mint) => ({ mint })),
      });

      mockBirdeyeClient.searchMarkets.mockResolvedValue(null);
      const mockCreationInfo = {
        txHash: 'tx1',
        slot: 12345,
        tokenAddress: validSolanaToken,
        decimals: 9,
        owner: 'owner1',
        blockUnixTime: 1234567890,
        blockHumanTime: '2024-01-01T00:00:00.000Z',
        creator: 'creator1',
      };

      mockBirdeyeClient.fetchTokenCreationInfo.mockResolvedValue(mockCreationInfo);
      mockClickHouseClient.insert.mockResolvedValue(undefined);

      const service = new MarketDataIngestionService(mockBirdeyeClient as unknown as BirdeyeClient);
      const result = await service.ingestForAllTokens({ chain: 'solana', limit: 1 });

      expect(mockBirdeyeClient.fetchTokenCreationInfo).toHaveBeenCalledWith(validSolanaToken, 'solana');
      expect(mockClickHouseClient.insert).toHaveBeenCalled();
      expect(result.tokenCreationInfoInserted).toBe(1);
    });

    it('should handle errors gracefully', async () => {
      const mockTokens = ['token1'];
      mockClickHouseClient.query.mockResolvedValue({
        json: async () => mockTokens.map((mint) => ({ mint })),
      });

      mockBirdeyeClient.searchMarkets.mockRejectedValue(new Error('API error'));

      const service = new MarketDataIngestionService(mockBirdeyeClient as unknown as BirdeyeClient);
      const result = await service.ingestForAllTokens({ chain: 'solana', limit: 1 });

      expect(result.tokensFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].token).toBe('token1');
    });

    it('should skip existing tokens when skipExisting is true', async () => {
      mockClickHouseClient.query.mockResolvedValue({
        json: async () => [],
      });

      const service = new MarketDataIngestionService(mockBirdeyeClient as unknown as BirdeyeClient);
      await service.ingestForAllTokens({ chain: 'solana', skipExisting: true });

      const queryCall = mockClickHouseClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain('LEFT JOIN');
      expect(queryCall.query).toContain('market_creation');
    });
  });
});
