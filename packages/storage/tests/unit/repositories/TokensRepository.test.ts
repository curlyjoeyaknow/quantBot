import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { TokensRepository } from '../../src/postgres/repositories/TokensRepository';
import { getPostgresPool, withPostgresTransaction } from '../../src/postgres-client';
import { createTokenAddress } from '@quantbot/core';

vi.mock('../../src/postgres-client', () => ({
  getPostgresPool: vi.fn(),
  withPostgresTransaction: vi.fn(),
}));

describe('TokensRepository', () => {
  let repository: TokensRepository;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new TokensRepository();
    mockPool = {
      query: vi.fn(),
    };
    mockClient = {
      query: vi.fn(),
    };
    vi.mocked(getPostgresPool).mockReturnValue(mockPool as any);
    vi.mocked(withPostgresTransaction).mockImplementation(async (callback: any) => {
      return callback(mockClient);
    });
  });

  describe('findById', () => {
    it('should find token by ID and preserve mint address case', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
      const mockToken = {
        id: 1,
        chain: 'solana',
        address: fullMint,
        symbol: 'TEST',
        name: 'Test Token',
        decimals: 9,
        metadata_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockPool.query.mockResolvedValue({ rows: [mockToken] });

      const result = await repository.findById(1);

      expect(result).toBeDefined();
      expect(result?.address).toBe(fullMint); // Case preserved
      expect(result?.id).toBe(1);
    });

    it('should return null if token not found', async () => {
      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await repository.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('findByAddress', () => {
    it('should find token by address and preserve case', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
      const mockToken = {
        id: 1,
        chain: 'solana',
        address: fullMint,
        symbol: 'TEST',
        name: null,
        decimals: null,
        metadata_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockPool.query.mockResolvedValue({ rows: [mockToken] });

      const result = await repository.findByAddress(createTokenAddress(fullMint), 'solana');

      expect(result).toBeDefined();
      expect(result?.address).toBe(fullMint);
    });
  });

  describe('getOrCreateToken', () => {
    it('should return existing token if found', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
      const mockToken = {
        id: 1,
        chain: 'solana',
        address: fullMint,
        symbol: 'TEST',
        name: null,
        decimals: null,
        metadata_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockToken] });

      const result = await repository.getOrCreateToken(createTokenAddress(fullMint), 'solana');

      expect(result.id).toBe(1);
      expect(result.address).toBe(fullMint);
    });

    it('should create new token if not found', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
      mockClient.query
        .mockResolvedValueOnce({ rows: [] }) // Not found
        .mockResolvedValueOnce({ rows: [{ id: 2 }] }); // Insert

      const result = await repository.getOrCreateToken(createTokenAddress(fullMint), 'solana', {
        symbol: 'NEW',
      });

      expect(result.id).toBe(2);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });
});
