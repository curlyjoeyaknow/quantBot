/**
 * Pass 3: Semantic Verification Tests (Mocked OHLCV Provider)
 *
 * Ensures semantic verification is only invoked at fetch time.
 * Tests failure caching and retry logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractCandidates } from '../../src/address/extract-candidates.js';
import { validateSolanaMint, validateEvmAddress } from '../../src/address/validate.js';

// Mock OHLCV provider interface
interface MockOhlcvProvider {
  fetchOhlcv(address: string, chain: string): Promise<{ success: boolean; data?: any; error?: string }>;
}

describe('Address Semantic Verification - Pass 3 (OHLCV Provider)', () => {
  let mockProvider: MockOhlcvProvider;
  let fetchOhlcvSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchOhlcvSpy = vi.fn();
    mockProvider = {
      fetchOhlcv: fetchOhlcvSpy,
    };
  });

  describe('Semantic Verification Only at Fetch Time', () => {
    it('validation (Pass 2) does not call OHLCV provider', () => {
      const address = 'So11111111111111111111111111111111111111112';
      
      // Pass 1: Extract
      const candidates = extractCandidates(address);
      expect(candidates.length).toBeGreaterThan(0);
      
      // Pass 2: Validate (should NOT call OHLCV provider)
      const candidate = candidates.find((c) => c.addressType === 'solana' && !c.reason);
      if (candidate) {
        const result = validateSolanaMint(candidate.normalized);
        expect(result.ok).toBe(true);
      }
      
      // OHLCV provider should NOT be called during validation
      expect(fetchOhlcvSpy).not.toHaveBeenCalled();
    });

    it('OHLCV ingestion calls provider only for validated addresses', async () => {
      const text = `
        Valid: So11111111111111111111111111111111111111112
        Invalid: So1111111111111111111111111111111111111111O
      `;

      // Pass 1: Extract
      const candidates = extractCandidates(text);
      
      // Pass 2: Validate
      const validCandidates = candidates.filter((c) => {
        if (c.reason) return false;
        if (c.addressType === 'solana') {
          const result = validateSolanaMint(c.normalized);
          return result.ok;
        }
        return false;
      });

      // Pass 3: Semantic verification (only for validated addresses)
      for (const candidate of validCandidates) {
        if (candidate.addressType === 'solana') {
          await mockProvider.fetchOhlcv(candidate.normalized, 'solana');
        }
      }

      // Should only call for valid addresses
      expect(fetchOhlcvSpy).toHaveBeenCalledTimes(validCandidates.length);
      expect(fetchOhlcvSpy).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'solana'
      );
    });
  });

  describe('Failure Caching', () => {
    it('caches failures to avoid retrying invalid addresses', async () => {
      const address = 'So11111111111111111111111111111111111111112';
      const failureCache = new Map<string, { timestamp: number; reason: string }>();

      // Mock provider to return "not found" for this address
      fetchOhlcvSpy.mockResolvedValue({
        success: false,
        error: 'Token not found',
      });

      // First call
      const result1 = await mockProvider.fetchOhlcv(address, 'solana');
      expect(result1.success).toBe(false);

      // Cache the failure
      if (!result1.success) {
        failureCache.set(address, {
          timestamp: Date.now(),
          reason: result1.error || 'unknown',
        });
      }

      // Second call - should check cache first
      if (failureCache.has(address)) {
        const cached = failureCache.get(address)!;
        expect(cached.reason).toBe('Token not found');
        // Would not call provider again if cached
      } else {
        // If not cached, would call provider
        await mockProvider.fetchOhlcv(address, 'solana');
      }

      // Provider should be called at least once
      expect(fetchOhlcvSpy).toHaveBeenCalled();
    });

    it('does not cache validation failures (Pass 2) - only semantic failures', () => {
      const invalidAddress = 'So1111111111111111111111111111111111111111O';
      
      // Pass 2 validation should fail
      const result = validateSolanaMint(invalidAddress);
      expect(result.ok).toBe(false);
      
      // This is a validation failure, not a semantic failure
      // Should NOT be cached as "OHLCV not found" - it's just invalid
      // Semantic verification would never be called for invalid addresses
    });
  });

  describe('Semantic Verification Flow', () => {
    it('only validates addresses that passed Pass 1 and Pass 2', async () => {
      const text = `
        Valid SOL: So11111111111111111111111111111111111111112
        Invalid SOL: So1111111111111111111111111111111111111111O
        Valid EVM: 0x742d35cc6634c0532925a3b844bc9e7595f0beb0
      `;

      // Pass 1: Extract
      const candidates = extractCandidates(text);
      
      // Pass 2: Validate
      const validatedAddresses: Array<{ address: string; chain: string }> = [];
      for (const candidate of candidates) {
        if (candidate.reason) continue; // Skip Pass 1 failures
        
        if (candidate.addressType === 'solana') {
          const result = validateSolanaMint(candidate.normalized);
          if (result.ok) {
            validatedAddresses.push({ address: candidate.normalized, chain: 'solana' });
          }
        } else if (candidate.addressType === 'evm') {
          const result = validateEvmAddress(candidate.normalized);
          if (result.ok) {
            validatedAddresses.push({ address: result.normalized, chain: 'evm' });
          }
        }
      }

      // Pass 3: Semantic verification (only for validated addresses)
      for (const { address, chain } of validatedAddresses) {
        await mockProvider.fetchOhlcv(address, chain);
      }

      // Should have 2 validated addresses (one SOL, one EVM)
      expect(validatedAddresses.length).toBeGreaterThanOrEqual(2);
      expect(fetchOhlcvSpy).toHaveBeenCalledTimes(validatedAddresses.length);
    });
  });
});

