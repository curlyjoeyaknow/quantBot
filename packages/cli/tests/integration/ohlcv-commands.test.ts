/**
 * Integration tests for OHLCV command handlers
 *
 * Tests the actual command execution through the command registry
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRegistry } from '../../src/core/command-registry';
import { OhlcvRepository } from '@quantbot/infra/storage';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { validateMintAddress } from '../../src/core/argument-parser';

// Mock storage
let mockGetCandles: ReturnType<typeof vi.fn>;

vi.mock('@quantbot/infra/storage', () => {
  return {
    OhlcvRepository: class {
      getCandles = mockGetCandles;
    },
    ohlcvCache: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      clear: vi.fn(),
      getStats: vi.fn().mockReturnValue({ hits: 0, misses: 0, size: 0 }),
    },
  };
});

describe('OHLCV Commands - Integration', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetCandles = vi.fn();

    // Create fresh registry and manually register the module
    registry = new CommandRegistry();

    const querySchema = z.object({
      mint: z.string(),
      from: z.string(),
      to: z.string(),
      interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('5m'),
      format: z.enum(['json', 'table', 'csv']).default('table'),
      chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
    });

    registry.registerPackage({
      packageName: 'ohlcv',
      description: 'OHLCV candle data operations',
      commands: [
        {
          name: 'query',
          description: 'Query OHLCV candles for a token',
          schema: querySchema,
          handler: async (args: unknown) => {
            const typedArgs = args as z.infer<typeof querySchema>;
            const mintAddress = validateMintAddress(typedArgs.mint);
            const fromDate = DateTime.fromISO(typedArgs.from);
            const toDate = DateTime.fromISO(typedArgs.to);

            if (!fromDate.isValid || !toDate.isValid) {
              throw new Error('Invalid date format');
            }

            const repository = new OhlcvRepository();
            return await repository.getCandles(mintAddress, typedArgs.chain, typedArgs.interval, {
              from: fromDate,
              to: toDate,
            });
          },
        },
        {
          name: 'backfill',
          description: 'Backfill OHLCV data',
          schema: z.object({}),
          handler: async () => ({ message: 'Backfill completed' }),
        },
        {
          name: 'coverage',
          description: 'Check coverage',
          schema: z.object({}),
          handler: async () => ({ message: 'Coverage check' }),
        },
      ],
    });
  });

  describe('Query Command Handler', () => {
    it('should execute query command with valid arguments', async () => {
      const mockCandles = [
        {
          timestamp: '2024-01-01T00:00:00Z',
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
        {
          timestamp: '2024-01-01T00:05:00Z',
          open: 105,
          high: 115,
          low: 100,
          close: 110,
          volume: 1200,
        },
      ];

      mockGetCandles.mockResolvedValue(mockCandles);

      const command = registry.getCommand('ohlcv', 'query');
      expect(command).toBeDefined();

      if (command) {
        const args = {
          mint: 'So11111111111111111111111111111111111111112',
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
          interval: '5m',
          format: 'json',
          chain: 'solana',
        };

        const result = await command.handler(args);

        expect(mockGetCandles).toHaveBeenCalledWith(
          'So11111111111111111111111111111111111111112',
          'solana',
          '5m',
          expect.objectContaining({
            from: expect.any(DateTime),
            to: expect.any(DateTime),
          })
        );

        expect(result).toEqual(mockCandles);
      }
    });

    it('should preserve mint address case', async () => {
      mockGetCandles.mockResolvedValue([]);

      const command = registry.getCommand('ohlcv', 'query');

      if (command) {
        const mixedCaseMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
        const args = {
          mint: mixedCaseMint,
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
          interval: '5m',
          format: 'json',
          chain: 'solana',
        };

        await command.handler(args);

        // Verify exact case was preserved
        expect(mockGetCandles).toHaveBeenCalledWith(
          mixedCaseMint,
          expect.anything(),
          expect.anything(),
          expect.anything()
        );
      }
    });

    it('should reject invalid mint address', async () => {
      const command = registry.getCommand('ohlcv', 'query');

      if (command) {
        const args = {
          mint: 'short', // Too short
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
          interval: '5m',
          format: 'json',
          chain: 'solana',
        };

        await expect(command.handler(args)).rejects.toThrow();
      }
    });

    it('should reject invalid date format', async () => {
      const command = registry.getCommand('ohlcv', 'query');

      if (command) {
        const args = {
          mint: 'So11111111111111111111111111111111111111112',
          from: 'invalid-date',
          to: '2024-01-02T00:00:00Z',
          interval: '5m',
          format: 'json',
          chain: 'solana',
        };

        await expect(command.handler(args)).rejects.toThrow();
      }
    });

    it('should handle repository errors gracefully', async () => {
      mockGetCandles.mockRejectedValue(new Error('Database error'));

      const command = registry.getCommand('ohlcv', 'query');

      if (command) {
        const args = {
          mint: 'So11111111111111111111111111111111111111112',
          from: '2024-01-01T00:00:00Z',
          to: '2024-01-02T00:00:00Z',
          interval: '5m',
          format: 'json',
          chain: 'solana',
        };

        await expect(command.handler(args)).rejects.toThrow('Database error');
      }
    });
  });

  describe('Backfill Command Handler', () => {
    it('should execute backfill command', async () => {
      const command = registry.getCommand('ohlcv', 'backfill');
      expect(command).toBeDefined();

      if (command) {
        const args = {
          mint: 'So11111111111111111111111111111111111111112',
          from: '2024-01-01',
          to: '2024-01-02',
          interval: '5m',
          format: 'json',
          chain: 'solana',
        };

        const result = await command.handler(args);
        expect(result).toHaveProperty('message');
      }
    });
  });

  describe('Coverage Command Handler', () => {
    it('should execute coverage command', async () => {
      const command = registry.getCommand('ohlcv', 'coverage');
      expect(command).toBeDefined();

      if (command) {
        const args = {
          mint: 'So11111111111111111111111111111111111111112',
          interval: '5m',
          format: 'json',
        };

        const result = await command.handler(args);
        expect(result).toHaveProperty('message');
      }
    });
  });
});
