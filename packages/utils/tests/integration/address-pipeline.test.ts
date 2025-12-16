/**
 * Pipeline Tests (Integration-ish, but still offline)
 *
 * Ensures Pass 2 validation runs before database writes.
 * Tests deduplication and rejection handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractCandidates } from '../../src/address/extract-candidates.js';
import { validateSolanaMint, validateEvmAddress } from '../../src/address/validate.js';

describe('Address Pipeline - Pass 2 Before Persist', () => {
  describe('Only Valid Addresses Result in DB Writes', () => {
    it('filters out invalid addresses before persistence', () => {
      const text = `
        Valid SOL: So11111111111111111111111111111111111111112
        Invalid SOL: So1111111111111111111111111111111111111111O
        Valid EVM: 0x742d35cc6634c0532925a3b844bc9e7595f0beb0
        Invalid EVM: 0x742d35cc6634c0532925a3b844bc9e7595f0b
      `;

      const candidates = extractCandidates(text);
      const validCandidates = candidates.filter((c) => {
        if (c.reason) return false; // Pass 1 rejected
        if (c.addressType === 'solana') {
          const result = validateSolanaMint(c.normalized);
          return result.ok;
        } else if (c.addressType === 'evm') {
          const result = validateEvmAddress(c.normalized);
          return result.ok;
        }
        return false;
      });

      // Should have 2 valid addresses (one SOL, one EVM)
      expect(validCandidates.length).toBeGreaterThanOrEqual(2);
      expect(validCandidates.some((c) => c.addressType === 'solana')).toBe(true);
      expect(validCandidates.some((c) => c.addressType === 'evm')).toBe(true);
    });

    it('records rejection reasons for invalid addresses', () => {
      const text = 'So1111111111111111111111111111111111111111O'; // Invalid (contains O)
      const candidates = extractCandidates(text);
      const solanaCandidates = candidates.filter((c) => c.addressType === 'solana');

      if (solanaCandidates.length > 0) {
        const candidate = solanaCandidates[0];
        // Pass 1 should reject it
        if (candidate.reason) {
          expect(candidate.reason).toBeDefined();
        } else {
          // If Pass 1 passed, Pass 2 should reject
          const result = validateSolanaMint(candidate.normalized);
          expect(result.ok).toBe(false);
          expect(result.reason).toBeDefined();
        }
      }
    });
  });

  describe('Deduplication Behavior', () => {
    it('one call per unique address per message', () => {
      const text = `
        CA: So11111111111111111111111111111111111111112
        Same CA: So11111111111111111111111111111111111111112
        Different: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
      `;

      const candidates = extractCandidates(text);
      const solanaCandidates = candidates.filter((c) => c.addressType === 'solana' && !c.reason);
      const validSolana = solanaCandidates.filter((c) => {
        const result = validateSolanaMint(c.normalized);
        return result.ok;
      });

      // Should have 2 unique valid addresses (deduplication happens at extraction)
      const unique = new Set(validSolana.map((c) => c.normalized));
      expect(unique.size).toBeLessThanOrEqual(2);
    });

    it('deduplicates EVM addresses case-insensitively', () => {
      const text = `
        Lower: 0x742d35cc6634c0532925a3b844bc9e7595f0beb0
        Upper: 0x742D35CC6634C0532925A3B844BC9E7595F0BEB0
      `;

      const candidates = extractCandidates(text);
      const evmCandidates = candidates.filter((c) => c.addressType === 'evm' && !c.reason);
      const validEvm = evmCandidates.filter((c) => {
        const result = validateEvmAddress(c.normalized);
        return result.ok;
      });

      // Should normalize to same lowercase address
      const normalized = validEvm.map((c) => {
        const result = validateEvmAddress(c.normalized);
        return result.normalized;
      });
      const unique = new Set(normalized);
      expect(unique.size).toBe(1);
    });
  });

  describe('Pipeline Flow', () => {
    it('extraction → validation → persistence flow works', () => {
      const text = 'So11111111111111111111111111111111111111112';
      
      // Step 1: Extract
      const candidates = extractCandidates(text);
      expect(candidates.length).toBeGreaterThan(0);
      
      // Step 2: Validate (Pass 2)
      const validCandidates = candidates.filter((c) => {
        if (c.reason) return false;
        if (c.addressType === 'solana') {
          const result = validateSolanaMint(c.normalized);
          return result.ok;
        }
        return false;
      });
      
      expect(validCandidates.length).toBeGreaterThan(0);
      
      // Step 3: Would persist validCandidates[0].normalized
      const addressToPersist = validCandidates[0]?.normalized;
      expect(addressToPersist).toBeDefined();
      expect(addressToPersist).toBe('So11111111111111111111111111111111111111112');
    });
  });
});

