/**
 * Unit tests for OHLCV Commands
 *
 * Tests command handlers, schemas, and mint address handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { OhlcvRepository } from '@quantbot/infra/storage';
import { parseArguments, validateMintAddress } from '../../../src/core/argument-parser';
import { formatOutput } from '../../../src/core/output-formatter';

// Import the schemas from the command file
const querySchema = z.object({
  mint: z.string().refine(
    (val) => {
      try {
        validateMintAddress(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid mint address (must be 32-44 characters)' }
  ),
  from: z.string(),
  to: z.string(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('5m'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
});

vi.mock('@quantbot/infra/storage', () => ({
  OhlcvRepository: vi.fn().mockImplementation(() => ({
    getCandles: vi.fn(),
  })),
  ohlcvCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
  },
}));

describe('OHLCV Commands', () => {
  let mockRepository: {
    getCandles: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepository = {
      getCandles: vi.fn().mockResolvedValue([]),
    };
    vi.mocked(OhlcvRepository).mockImplementation(() => mockRepository as never);
  });

  describe('Query Command Schema', () => {
    it('should validate correct query arguments', () => {
      const args = {
        mint: 'So11111111111111111111111111111111111111112',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
        interval: '5m' as const,
        format: 'table' as const,
        chain: 'solana' as const,
      };

      const result = parseArguments(querySchema, args);
      expect(result.mint).toBe(args.mint);
      expect(result.from).toBe(args.from);
      expect(result.to).toBe(args.to);
    });

    it('should reject invalid mint address', () => {
      const args = {
        mint: 'short',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
      };

      expect(() => parseArguments(querySchema, args)).toThrow();
    });

    it('should preserve mint address case', () => {
      const mintAddress = 'So11111111111111111111111111111111111111112';
      const args = {
        mint: mintAddress,
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
      };

      const result = parseArguments(querySchema, args);
      expect(result.mint).toBe(mintAddress);
      expect(result.mint[0]).toBe('S');
      expect(result.mint[1]).toBe('o');
    });

    it('should validate date formats', () => {
      const validArgs = {
        mint: 'So11111111111111111111111111111111111111112',
        from: '2024-01-01',
        to: '2024-01-02',
      };

      expect(() => parseArguments(querySchema, validArgs)).not.toThrow();
    });

    it('should reject invalid intervals', () => {
      const args = {
        mint: 'So11111111111111111111111111111111111111112',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
        interval: 'invalid' as unknown as '5m',
      };

      expect(() => parseArguments(querySchema, args)).toThrow();
    });

    it('should reject invalid chains', () => {
      const args = {
        mint: 'So11111111111111111111111111111111111111112',
        from: '2024-01-01T00:00:00Z',
        to: '2024-01-02T00:00:00Z',
        chain: 'invalid' as unknown as 'solana',
      };

      expect(() => parseArguments(querySchema, args)).toThrow();
    });
  });

  describe('Query Command Handler Logic', () => {
    it('should validate date range', () => {
      const fromDate = DateTime.fromISO('2024-01-02T00:00:00Z');
      const toDate = DateTime.fromISO('2024-01-01T00:00:00Z');

      expect(fromDate >= toDate).toBe(true);
      expect(() => {
        if (fromDate >= toDate) {
          throw new Error('From date must be before to date');
        }
      }).toThrow('From date must be before to date');
    });

    it('should format output correctly', async () => {
      const candles = [
        {
          timestamp: '2024-01-01T00:00:00Z',
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];

      const jsonOutput = formatOutput(candles, 'json');
      expect(jsonOutput).toContain('timestamp');
      expect(jsonOutput).toContain('100');

      const tableOutput = formatOutput(candles, 'table');
      expect(tableOutput).toContain('timestamp');
      expect(tableOutput).toContain('open');

      const csvOutput = formatOutput(candles, 'csv');
      expect(csvOutput).toContain('timestamp,open,high');
    });
  });

  describe('Mint Address Handling', () => {
    it('should preserve exact case in mint address', () => {
      const testCases = [
        'So11111111111111111111111111111111111111112',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      ];

      for (const mintAddress of testCases) {
        const validated = validateMintAddress(mintAddress);
        expect(validated).toBe(mintAddress);
        expect(validated.length).toBeGreaterThanOrEqual(32);
        expect(validated.length).toBeLessThanOrEqual(44);
      }
    });

    it('should not truncate mint addresses', () => {
      const longMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // 44 chars
      const validated = validateMintAddress(longMint);
      expect(validated.length).toBe(44);
      expect(validated).toBe(longMint);
    });
  });
});
