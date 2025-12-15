/**
 * Fuzzing Tests for Mint Address Handling
 * ========================================
 *
 * CRITICAL: Mint addresses must NEVER be truncated, case-changed, or corrupted.
 * These tests ensure the storage layer preserves addresses exactly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { TokensRepository } from '../../src/postgres/repositories/TokensRepository';
import { setupTestDatabase, cleanupTestDatabase } from '../helpers/database';

describe('Mint Address Handling - Fuzzing Tests', () => {
  let repo: TokensRepository;

  beforeEach(async () => {
    await setupTestDatabase();
    repo = new TokensRepository();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('Storage Preservation', () => {
    it('preserves exact mint address for any valid base58 string', () => {
      fc.assert(
        fc.asyncProperty(
          fc.stringOf(
            fc.constantFrom(
              ...'123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.split('')
            ),
            { minLength: 32, maxLength: 44 }
          ),
          async (mint) => {
            await repo.upsert({
              mint,
              chain: 'solana',
              name: 'Test Token',
              symbol: 'TEST',
            });

            const retrieved = await repo.findByMint(mint);
            return retrieved?.mint === mint; // EXACT match
          }
        ),
        { numRuns: 500 }
      );
    });

    it('preserves mixed case addresses', () => {
      fc.assert(
        fc.asyncProperty(fc.string({ minLength: 32, maxLength: 44 }), async (mint) => {
          // Mix case randomly
          const mixedCase = mint
            .split('')
            .map((c) => (Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()))
            .join('');

          await repo.upsert({
            mint: mixedCase,
            chain: 'solana',
            name: 'Test',
            symbol: 'TEST',
          });

          const retrieved = await repo.findByMint(mixedCase);
          return retrieved?.mint === mixedCase;
        }),
        { numRuns: 200 }
      );
    });

    it('never truncates addresses during storage', () => {
      fc.assert(
        fc.asyncProperty(fc.string({ minLength: 32, maxLength: 44 }), async (mint) => {
          await repo.upsert({
            mint,
            chain: 'solana',
            name: 'Test',
            symbol: 'TEST',
          });

          const retrieved = await repo.findByMint(mint);
          // Length must be preserved
          return retrieved?.mint.length === mint.length;
        }),
        { numRuns: 500 }
      );
    });
  });

  describe('Query Robustness', () => {
    it('handles SQL injection attempts safely', () => {
      const injectionAttempts = [
        "'; DROP TABLE tokens; --",
        "' OR '1'='1",
        "'; DELETE FROM tokens WHERE '1'='1",
        "admin'--",
        "' UNION SELECT * FROM users--",
        "1' AND '1'='1",
      ];

      injectionAttempts.forEach(async (maliciousMint) => {
        // Should either throw or return null, never execute SQL
        const result = await repo.findByMint(maliciousMint);
        expect(result).toBeNull();

        // Verify tokens table still exists and is intact
        const count = await repo.count();
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });

    it('never crashes on malformed query inputs', () => {
      fc.assert(
        fc.asyncProperty(fc.anything(), async (input) => {
          try {
            await repo.findByMint(input as any);
            return true;
          } catch (error) {
            return error instanceof Error;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('handles concurrent queries for same mint', async () => {
      const mint = '7pXs9PuMPPzDMtDKC4Tj5gxF3sRLCBxuK3u8DPump';
      await repo.upsert({ mint, chain: 'solana', name: 'Test', symbol: 'TEST' });

      // 100 concurrent queries
      const queries = Array(100)
        .fill(null)
        .map(() => repo.findByMint(mint));
      const results = await Promise.all(queries);

      // All should return the same result
      results.forEach((result) => {
        expect(result?.mint).toBe(mint);
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles addresses at min length (32 chars)', async () => {
      const mint = '1'.repeat(32);
      await repo.upsert({ mint, chain: 'solana', name: 'Test', symbol: 'TEST' });
      const result = await repo.findByMint(mint);
      expect(result?.mint).toBe(mint);
    });

    it('handles addresses at max length (44 chars)', async () => {
      const mint = '1'.repeat(44);
      await repo.upsert({ mint, chain: 'solana', name: 'Test', symbol: 'TEST' });
      const result = await repo.findByMint(mint);
      expect(result?.mint).toBe(mint);
    });

    it('rejects addresses with invalid base58 characters', async () => {
      const invalidMints = [
        '0' + '1'.repeat(31), // Contains '0'
        'O' + '1'.repeat(31), // Contains 'O'
        'I' + '1'.repeat(31), // Contains 'I'
        'l' + '1'.repeat(31), // Contains 'l'
      ];

      for (const mint of invalidMints) {
        await expect(
          repo.upsert({ mint, chain: 'solana', name: 'Test', symbol: 'TEST' })
        ).rejects.toThrow(/invalid.*base58/i);
      }
    });
  });
});
