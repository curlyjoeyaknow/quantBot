/**
 * Tests for TokenMetadataRepository
 * 
 * Tests cover:
 * - Metadata storage with mint address preservation
 * - Latest metadata retrieval
 * - Metadata history retrieval
 * - Case sensitivity
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { TokenMetadataRepository } from '../src/clickhouse/repositories/TokenMetadataRepository';
import { getClickHouseClient } from '../src/clickhouse-client';
import type { TokenMetadata } from '@quantbot/core';

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

describe('TokenMetadataRepository', () => {
  let repo: TokenMetadataRepository;
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
    repo = new TokenMetadataRepository();
  });

  describe('upsertMetadata', () => {
    it('should preserve full mint address and exact case', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
        price: 0.001,
        marketCap: 1000000,
      };

      await repo.upsertMetadata(FULL_MINT, 'solana', 1000, metadata);

      expect(mockClient.insert).toHaveBeenCalled();
      const insertCall = mockClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].token_address).toBe(FULL_MINT);
    });

    it('should preserve lowercase mint address', async () => {
      const metadata: TokenMetadata = {
        name: 'Test Token',
        symbol: 'TEST',
      };

      await repo.upsertMetadata(FULL_MINT_LOWERCASE, 'solana', 1000, metadata);

      const insertCall = mockClient.insert.mock.calls[0][0];
      expect(insertCall.values[0].token_address).toBe(FULL_MINT_LOWERCASE);
    });

    it('should serialize socials and metadata correctly', async () => {
      const metadata: TokenMetadata & { socials?: any; creator?: string } = {
        name: 'Test Token',
        symbol: 'TEST',
        socials: {
          twitter: 'https://twitter.com/test',
          telegram: 'https://t.me/test',
        },
        creator: 'Creator123',
      };

      await repo.upsertMetadata(FULL_MINT, 'solana', 1000, metadata);

      const insertCall = mockClient.insert.mock.calls[0][0];
      const socials = JSON.parse(insertCall.values[0].socials_json);
      expect(socials.twitter).toBe('https://twitter.com/test');
      expect(insertCall.values[0].creator).toBe('Creator123');
    });
  });

  describe('getLatestMetadata', () => {
    it('should preserve full mint address in queries', async () => {
      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await repo.getLatestMetadata(FULL_MINT, 'solana');

      const queryCall = mockClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT);
    });

    it('should return latest metadata', async () => {
      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          {
            timestamp: 2000,
            token_address: FULL_MINT,
            chain: 'solana',
            name: 'Test Token',
            symbol: 'TEST',
            price: 0.001,
            market_cap: 1000000,
            volume_24h: 50000,
            price_change_24h: 10.5,
            logo_uri: 'https://example.com/logo.png',
            socials_json: '{}',
            creator: null,
            top_wallet_holdings: null,
            metadata_json: '{}',
          },
        ]),
      });

      const result = await repo.getLatestMetadata(FULL_MINT, 'solana');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Token');
      expect(result?.symbol).toBe('TEST');
      expect(result?.price).toBe(0.001);
      expect(result?.marketCap).toBe(1000000);
    });

    it('should return null when no metadata found', async () => {
      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      const result = await repo.getLatestMetadata(FULL_MINT, 'solana');

      expect(result).toBeNull();
    });
  });

  describe('getMetadataHistory', () => {
    it('should preserve full mint address in queries', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);

      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([]),
      });

      await repo.getMetadataHistory(FULL_MINT, 'solana', startTime, endTime);

      const queryCall = mockClient.query.mock.calls[0][0];
      expect(queryCall.query).toContain(FULL_MINT);
    });

    it('should return metadata history ordered by timestamp', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);

      mockClient.query.mockResolvedValue({
        json: vi.fn().mockResolvedValue([
          {
            timestamp: 1000,
            token_address: FULL_MINT,
            chain: 'solana',
            name: 'Test Token',
            symbol: 'TEST',
            price: 0.001,
            market_cap: 1000000,
            volume_24h: null,
            price_change_24h: null,
            logo_uri: null,
            socials_json: '{}',
            creator: null,
            top_wallet_holdings: null,
            metadata_json: '{}',
          },
          {
            timestamp: 1500,
            token_address: FULL_MINT,
            chain: 'solana',
            name: 'Test Token',
            symbol: 'TEST',
            price: 0.0015,
            market_cap: 1500000,
            volume_24h: null,
            price_change_24h: null,
            logo_uri: null,
            socials_json: '{}',
            creator: null,
            top_wallet_holdings: null,
            metadata_json: '{}',
          },
        ]),
      });

      const result = await repo.getMetadataHistory(FULL_MINT, 'solana', startTime, endTime);

      expect(result.length).toBe(2);
      expect(result[0].timestamp).toBe(1000);
      expect(result[1].timestamp).toBe(1500);
      expect(result[0].price).toBe(0.001);
      expect(result[1].price).toBe(0.0015);
    });
  });
});

