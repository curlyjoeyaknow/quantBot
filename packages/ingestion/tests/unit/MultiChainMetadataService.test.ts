import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMultiChainMetadata,
  batchFetchMultiChainMetadata,
  getMetadataCache,
} from '@quantbot/api-clients';
import type { BirdeyeClient } from '@quantbot/api-clients';

// Mock retryWithBackoff is handled in tests/setup.ts

// Create a mock cache with real Map behavior
function createMockCache() {
  const cacheMap = new Map<string, any>();
  return {
    get: vi.fn((address: string, chain: string) => {
      const key = `${chain.toLowerCase()}:${address.toLowerCase()}`;
      return cacheMap.get(key) || null;
    }),
    set: vi.fn((address: string, chain: string, metadata: any) => {
      const key = `${chain.toLowerCase()}:${address.toLowerCase()}`;
      cacheMap.set(key, metadata);
    }),
    clear: vi.fn(() => {
      cacheMap.clear();
    }),
    getAnyChain: vi.fn((address: string, chains: string[]) => {
      for (const chain of chains) {
        const key = `${chain.toLowerCase()}:${address.toLowerCase()}`;
        const cached = cacheMap.get(key);
        if (cached && cached.found) {
          return { chain, metadata: cached };
        }
      }
      return null;
    }),
    size: vi.fn(() => cacheMap.size),
  };
}

// Mock the cache module
vi.mock('@quantbot/api-clients/src/multi-chain-metadata-cache.js', () => {
  const mockCache = createMockCache();
  return {
    getMetadataCache: vi.fn(() => mockCache),
    MultiChainMetadataCache: vi.fn(),
  };
});

describe('MultiChainMetadataService', () => {
  let mockGetTokenMetadata: ReturnType<typeof vi.fn>;
  let mockBirdeyeClient: BirdeyeClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock client using dependency injection
    mockGetTokenMetadata = vi.fn();
    mockBirdeyeClient = {
      getTokenMetadata: mockGetTokenMetadata,
    } as unknown as BirdeyeClient;

    // Clear cache between tests
    getMetadataCache().clear();
  });

  // Helper to create client factory for dependency injection
  function createClientFactory() {
    return () => mockBirdeyeClient;
  }

  describe('fetchMultiChainMetadata - Solana', () => {
    it('should fetch metadata for valid Solana address', async () => {
      const solanaAddress = 'So11111111111111111111111111111111111111112';

      mockGetTokenMetadata.mockResolvedValue({
        name: 'Wrapped SOL',
        symbol: 'WSOL',
      });

      // Use dependency injection to pass mock client factory
      const result = await fetchMultiChainMetadata(solanaAddress, undefined, createClientFactory());

      // Verify mock was called
      expect(mockGetTokenMetadata).toHaveBeenCalledWith(solanaAddress, 'solana');

      expect(result.addressKind).toBe('solana');
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0]!.chain).toBe('solana');
      expect(result.metadata[0]!.found).toBe(true);
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.name).toBe('Wrapped SOL');
      expect(result.primaryMetadata?.symbol).toBe('WSOL');
    });

    it('should handle Solana address not found', async () => {
      const solanaAddress = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      mockGetTokenMetadata.mockResolvedValue(null);

      const result = await fetchMultiChainMetadata(solanaAddress, undefined, createClientFactory());

      expect(result.addressKind).toBe('solana');
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0].found).toBe(false);
      expect(result.primaryMetadata).toBeUndefined();
    });

    it('should handle Solana API errors gracefully', async () => {
      // Use a valid Solana address (base58, 32-44 chars) - using a known valid format
      const solanaAddress = 'ErrorTestTokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss';

      mockGetTokenMetadata.mockRejectedValue(new Error('API Error'));

      const result = await fetchMultiChainMetadata(solanaAddress, undefined, createClientFactory());

      expect(result.addressKind).toBe('solana');
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0].found).toBe(false);
      expect(result.primaryMetadata).toBeUndefined();
    });
  });

  describe('fetchMultiChainMetadata - EVM', () => {
    it('should fetch metadata for EVM address on first chain (Ethereum)', async () => {
      const evmAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      // All chains are queried in parallel now, but we prioritize the first successful result
      // Ethereum succeeds, base and bsc return null
      mockGetTokenMetadata
        .mockResolvedValueOnce({
          name: 'USD Coin',
          symbol: 'USDC',
        })
        .mockResolvedValueOnce(null) // base
        .mockResolvedValueOnce(null); // bsc

      const result = await fetchMultiChainMetadata(evmAddress, undefined, createClientFactory());

      expect(result.addressKind).toBe('evm');
      expect(result.metadata.length).toBe(3); // All 3 chains queried
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('ethereum');
      expect(result.primaryMetadata?.name).toBe('USD Coin');
      expect(result.primaryMetadata?.symbol).toBe('USDC');
    });

    it('should try all EVM chains and find on second chain (Base)', async () => {
      const evmAddress = '0x1111111111111111111111111111111111111111';

      // All chains queried in parallel: ethereum fails, base succeeds, bsc fails
      mockGetTokenMetadata
        .mockResolvedValueOnce(null) // ethereum
        .mockResolvedValueOnce({
          name: 'Base Token',
          symbol: 'BASE',
        }) // base
        .mockResolvedValueOnce(null); // bsc

      const result = await fetchMultiChainMetadata(evmAddress, undefined, createClientFactory());

      expect(result.addressKind).toBe('evm');
      expect(result.metadata.length).toBe(3); // All 3 chains queried
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('base');
      expect(result.primaryMetadata?.name).toBe('Base Token');
    });

    it('should try all EVM chains and find on third chain (BSC)', async () => {
      const evmAddress = '0x2222222222222222222222222222222222222222';

      // First call (ethereum) fails
      mockGetTokenMetadata.mockResolvedValueOnce(null);
      // Second call (base) fails
      mockGetTokenMetadata.mockResolvedValueOnce(null);
      // Third call (bsc) succeeds
      mockGetTokenMetadata.mockResolvedValueOnce({
        name: 'BSC Token',
        symbol: 'BSC',
      });

      const result = await fetchMultiChainMetadata(evmAddress, undefined, createClientFactory());

      expect(result.addressKind).toBe('evm');
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('bsc');
      expect(result.primaryMetadata?.name).toBe('BSC Token');
    });

    it('should return no primary metadata if not found on any EVM chain', async () => {
      const evmAddress = '0x3333333333333333333333333333333333333333';

      // All calls fail
      mockGetTokenMetadata.mockResolvedValue(null);

      const result = await fetchMultiChainMetadata(evmAddress, undefined, createClientFactory());

      expect(result.addressKind).toBe('evm');
      expect(result.metadata.length).toBe(3); // Tried all 3 chains
      expect(result.metadata.every((m) => !m.found)).toBe(true);
      expect(result.primaryMetadata).toBeUndefined();
    });

    it('should prioritize chainHint for EVM addresses', async () => {
      const evmAddress = '0x4444444444444444444444444444444444444444';

      // All chains queried in parallel, but base (hint) is first in array
      // base succeeds, ethereum and bsc return null
      mockGetTokenMetadata
        .mockResolvedValueOnce({
          name: 'Base Token',
          symbol: 'BASE',
        }) // base (hint)
        .mockResolvedValueOnce(null) // ethereum
        .mockResolvedValueOnce(null); // bsc

      const result = await fetchMultiChainMetadata(evmAddress, 'base', createClientFactory());

      expect(result.addressKind).toBe('evm');
      expect(result.chainHint).toBe('base');
      expect(result.metadata.length).toBe(3); // All 3 chains queried
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('base');

      // Verify all chains were called (parallel queries)
      expect(mockGetTokenMetadata).toHaveBeenCalledWith(evmAddress, 'base');
      expect(mockGetTokenMetadata).toHaveBeenCalledWith(evmAddress, 'ethereum');
      expect(mockGetTokenMetadata).toHaveBeenCalledWith(evmAddress, 'bsc');
    });
  });

  describe('batchFetchMultiChainMetadata', () => {
    it('should fetch metadata for multiple addresses in parallel batches', async () => {
      // Use valid Solana address (base58, 32-44 chars) and unique addresses to avoid cache
      const addresses = [
        'BatchTestTokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss', // Solana (valid base58)
        '0xBatchTest1111111111111111111111111111111111', // EVM
      ];

      mockGetTokenMetadata
        .mockResolvedValueOnce({ name: 'Wrapped SOL', symbol: 'WSOL' }) // Solana
        .mockResolvedValueOnce({ name: 'USD Coin', symbol: 'USDC' }) // EVM ethereum
        .mockResolvedValueOnce(null) // EVM base
        .mockResolvedValueOnce(null); // EVM bsc

      const results = await batchFetchMultiChainMetadata(
        addresses,
        undefined,
        5,
        createClientFactory()
      );

      expect(results).toHaveLength(2);
      expect(results[0].addressKind).toBe('solana');
      expect(results[0].primaryMetadata?.symbol).toBe('WSOL');
      expect(results[1].addressKind).toBe('evm');
      expect(results[1].primaryMetadata?.symbol).toBe('USDC');
    });

    it('should handle errors in batch gracefully', async () => {
      // Use valid Solana address (base58, 32-44 chars) and unique addresses to avoid cache
      // Using a known valid Solana address - TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (44 chars)
      const addresses = [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Solana (known valid, 44 chars)
        '0xBatchError1111111111111111111111111111111111', // EVM
      ];

      // Since batch processing is parallel, we need to account for all possible calls
      // Solana: 1 call (fails)
      // EVM: 3 calls (ethereum, base, bsc)
      mockGetTokenMetadata
        .mockRejectedValueOnce(new Error('API Error')) // Solana fails
        .mockResolvedValueOnce({ name: 'USD Coin', symbol: 'USDC' }) // EVM ethereum
        .mockResolvedValueOnce(null) // EVM base
        .mockResolvedValueOnce(null); // EVM bsc

      const results = await batchFetchMultiChainMetadata(
        addresses,
        undefined,
        5,
        createClientFactory()
      );

      expect(results).toHaveLength(2);
      // The Solana address should fail (no primaryMetadata)
      // Find which result is Solana by addressKind
      const solanaResult = results.find((r) => r.addressKind === 'solana');
      const evmResult = results.find((r) => r.addressKind === 'evm');

      expect(solanaResult).toBeDefined();
      expect(solanaResult?.primaryMetadata).toBeUndefined(); // Failed
      expect(evmResult).toBeDefined();
      expect(evmResult?.primaryMetadata?.symbol).toBe('USDC'); // Success
    });
  });
});
