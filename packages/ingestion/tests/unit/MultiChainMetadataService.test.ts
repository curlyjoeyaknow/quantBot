import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchMultiChainMetadata,
  batchFetchMultiChainMetadata,
} from '../../src/MultiChainMetadataService.js';

// Create mock function at module level
const mockGetTokenMetadata = vi.fn();

// Mock the api-clients module
vi.mock('@quantbot/api-clients', () => {
  return {
    getBirdeyeClient: vi.fn(() => ({
      getTokenMetadata: mockGetTokenMetadata,
    })),
  };
});

describe('MultiChainMetadataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTokenMetadata.mockReset();
  });

  describe('fetchMultiChainMetadata - Solana', () => {
    it('should fetch metadata for valid Solana address', async () => {
      const solanaAddress = 'So11111111111111111111111111111111111111112';

      mockGetTokenMetadata.mockResolvedValue({
        name: 'Wrapped SOL',
        symbol: 'WSOL',
      });

      const result = await fetchMultiChainMetadata(solanaAddress);

      expect(result.addressKind).toBe('solana');
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0].chain).toBe('solana');
      expect(result.metadata[0].found).toBe(true);
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.name).toBe('Wrapped SOL');
      expect(result.primaryMetadata?.symbol).toBe('WSOL');
    });

    it('should handle Solana address not found', async () => {
      const solanaAddress = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      mockGetTokenMetadata.mockResolvedValue(null);

      const result = await fetchMultiChainMetadata(solanaAddress);

      expect(result.addressKind).toBe('solana');
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0].found).toBe(false);
      expect(result.primaryMetadata).toBeUndefined();
    });

    it('should handle Solana API errors gracefully', async () => {
      const solanaAddress = 'So11111111111111111111111111111111111111112';

      mockGetTokenMetadata.mockRejectedValue(new Error('API Error'));

      const result = await fetchMultiChainMetadata(solanaAddress);

      expect(result.addressKind).toBe('solana');
      expect(result.metadata).toHaveLength(1);
      expect(result.metadata[0].found).toBe(false);
      expect(result.primaryMetadata).toBeUndefined();
    });
  });

  describe('fetchMultiChainMetadata - EVM', () => {
    it('should fetch metadata for EVM address on first chain (Ethereum)', async () => {
      const evmAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

      // First call (ethereum) succeeds
      mockGetTokenMetadata.mockResolvedValueOnce({
        name: 'USD Coin',
        symbol: 'USDC',
      });
      // Second call (base) not needed
      // Third call (bsc) not needed

      const result = await fetchMultiChainMetadata(evmAddress);

      expect(result.addressKind).toBe('evm');
      expect(result.metadata.length).toBeGreaterThanOrEqual(1);
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('ethereum');
      expect(result.primaryMetadata?.name).toBe('USD Coin');
      expect(result.primaryMetadata?.symbol).toBe('USDC');
    });

    it('should try all EVM chains and find on second chain (Base)', async () => {
      const evmAddress = '0x1111111111111111111111111111111111111111';

      // First call (ethereum) fails
      mockGetTokenMetadata.mockResolvedValueOnce(null);
      // Second call (base) succeeds
      mockGetTokenMetadata.mockResolvedValueOnce({
        name: 'Base Token',
        symbol: 'BASE',
      });
      // Third call (bsc) not needed

      const result = await fetchMultiChainMetadata(evmAddress);

      expect(result.addressKind).toBe('evm');
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

      const result = await fetchMultiChainMetadata(evmAddress);

      expect(result.addressKind).toBe('evm');
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('bsc');
      expect(result.primaryMetadata?.name).toBe('BSC Token');
    });

    it('should return no primary metadata if not found on any EVM chain', async () => {
      const evmAddress = '0x3333333333333333333333333333333333333333';

      // All calls fail
      mockGetTokenMetadata.mockResolvedValue(null);

      const result = await fetchMultiChainMetadata(evmAddress);

      expect(result.addressKind).toBe('evm');
      expect(result.metadata.length).toBe(3); // Tried all 3 chains
      expect(result.metadata.every((m) => !m.found)).toBe(true);
      expect(result.primaryMetadata).toBeUndefined();
    });

    it('should prioritize chainHint for EVM addresses', async () => {
      const evmAddress = '0x4444444444444444444444444444444444444444';

      // First call (base - from hint) succeeds
      mockGetTokenMetadata.mockResolvedValueOnce({
        name: 'Base Token',
        symbol: 'BASE',
      });

      const result = await fetchMultiChainMetadata(evmAddress, 'base');

      expect(result.addressKind).toBe('evm');
      expect(result.chainHint).toBe('base');
      expect(result.primaryMetadata).toBeDefined();
      expect(result.primaryMetadata?.chain).toBe('base');

      // Verify base was tried first (chainHint prioritization)
      expect(mockGetTokenMetadata).toHaveBeenCalledWith(evmAddress, 'base');
    });
  });

  describe('batchFetchMultiChainMetadata', () => {
    it('should fetch metadata for multiple addresses sequentially', async () => {
      const addresses = [
        'So11111111111111111111111111111111111111112', // Solana
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // EVM
      ];

      mockGetTokenMetadata
        .mockResolvedValueOnce({ name: 'Wrapped SOL', symbol: 'WSOL' })
        .mockResolvedValueOnce({ name: 'USD Coin', symbol: 'USDC' });

      const results = await batchFetchMultiChainMetadata(addresses);

      expect(results).toHaveLength(2);
      expect(results[0].addressKind).toBe('solana');
      expect(results[0].primaryMetadata?.symbol).toBe('WSOL');
      expect(results[1].addressKind).toBe('evm');
      expect(results[1].primaryMetadata?.symbol).toBe('USDC');
    });

    it('should handle errors in batch gracefully', async () => {
      const addresses = [
        'So11111111111111111111111111111111111111112', // Solana
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // EVM
      ];

      mockGetTokenMetadata
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({ name: 'USD Coin', symbol: 'USDC' });

      const results = await batchFetchMultiChainMetadata(addresses);

      expect(results).toHaveLength(2);
      expect(results[0].primaryMetadata).toBeUndefined(); // Failed
      expect(results[1].primaryMetadata?.symbol).toBe('USDC'); // Success
    });
  });
});
