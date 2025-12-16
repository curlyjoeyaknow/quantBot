/**
 * Property Tests for Address Extraction Normalization
 *
 * Uses fast-check to generate random punctuation around valid addresses
 * and assert normalization is stable.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { extractCandidates, normalizeCandidate } from '../../src/address/extract-candidates.js';

describe('Address Extraction - Property Tests', () => {
  // Known valid addresses
  const validSolanaAddress = 'So11111111111111111111111111111111111111112';
  const validEvmAddress = '0x742d35cc6634c0532925a3b844bc9e7595f0beb0';

  describe('Normalization Stability (Punctuation Wrapping)', () => {
    it('for any valid Solana address A, and any wrapping punctuation P1/P2, extractCandidates(P1 + A + P2) returns A unchanged', () => {
      const punctuation = ['(', ')', '[', ']', ',', '.', ';', ':', '!', '?'];
      
      fc.assert(
        fc.property(
          fc.constantFrom(...punctuation),
          fc.constantFrom(...punctuation),
          (p1, p2) => {
            const wrapped = `${p1}${validSolanaAddress}${p2}`;
            const candidates = extractCandidates(wrapped);
            const solanaCandidates = candidates.filter((c) => c.addressType === 'solana' && !c.reason);
            
            if (solanaCandidates.length > 0) {
              expect(solanaCandidates[0]?.normalized).toBe(validSolanaAddress);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('for any valid EVM address A, and any wrapping punctuation P1/P2, extractCandidates(P1 + A + P2) returns A unchanged', () => {
      const punctuation = ['(', ')', '[', ']', ',', '.', ';', ':', '!', '?'];
      
      fc.assert(
        fc.property(
          fc.constantFrom(...punctuation),
          fc.constantFrom(...punctuation),
          (p1, p2) => {
            const wrapped = `${p1}${validEvmAddress}${p2}`;
            const candidates = extractCandidates(wrapped);
            const evmCandidates = candidates.filter((c) => c.addressType === 'evm' && !c.reason);
            
            if (evmCandidates.length > 0) {
              expect(evmCandidates[0]?.normalized).toBe(validEvmAddress);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Normalization Idempotency', () => {
    it('normalizeCandidate is idempotent: normalize(normalize(x)) === normalize(x)', () => {
      const testCases = [
        validSolanaAddress,
        validEvmAddress,
        `(${validSolanaAddress})`,
        `[${validEvmAddress}]`,
        `  ${validSolanaAddress}  `,
      ];

      for (const input of testCases) {
        const once = normalizeCandidate(input);
        const twice = normalizeCandidate(once);
        expect(twice).toBe(once);
      }
    });
  });

  describe('Case Preservation', () => {
    it('normalizeCandidate preserves case for Solana addresses', () => {
      const mixedCase = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const normalized = normalizeCandidate(mixedCase);
      expect(normalized).toBe(mixedCase);
      expect(normalized).not.toBe(mixedCase.toLowerCase());
      expect(normalized).not.toBe(mixedCase.toUpperCase());
    });

    it('extractCandidates preserves case for Solana addresses', () => {
      const mixedCase = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const candidates = extractCandidates(mixedCase);
      const solanaCandidates = candidates.filter((c) => c.addressType === 'solana' && !c.reason);
      
      if (solanaCandidates.length > 0) {
        expect(solanaCandidates[0]?.normalized).toBe(mixedCase);
      }
    });
  });

  describe('Deduplication Property', () => {
    it('extractCandidates deduplicates identical addresses (case-sensitive for Solana)', () => {
      const text = `
        ${validSolanaAddress}
        ${validSolanaAddress}
        ${validSolanaAddress}
      `;
      const candidates = extractCandidates(text);
      const solanaCandidates = candidates.filter((c) => c.addressType === 'solana' && !c.reason);
      const unique = new Set(solanaCandidates.map((c) => c.normalized));
      expect(unique.size).toBe(1);
    });

    it('extractCandidates deduplicates identical EVM addresses', () => {
      const text = `
        ${validEvmAddress}
        ${validEvmAddress}
        ${validEvmAddress}
      `;
      const candidates = extractCandidates(text);
      const evmCandidates = candidates.filter((c) => c.addressType === 'evm' && !c.reason);
      const unique = new Set(evmCandidates.map((c) => c.normalized));
      expect(unique.size).toBe(1);
    });
  });
});

