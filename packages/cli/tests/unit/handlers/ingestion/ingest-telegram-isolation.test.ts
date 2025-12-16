/**
 * Isolation Test - Litmus Test for ingestTelegramHandler
 *
 * This test verifies the handler can be:
 * - Imported into a REPL
 * - Called with plain objects
 * - Returns deterministic results
 *
 * If this test passes, the handler is properly decoupled from CLI infrastructure.
 */

import { describe, it, expect, vi } from 'vitest';
import { ingestTelegramHandler } from '../../../../src/handlers/ingestion/ingest-telegram.js';

describe('ingestTelegramHandler - Isolation Test', () => {
  it('can be called with plain objects (no CLI infrastructure)', async () => {
    // Plain object args (as if from a REPL or script)
    const plainArgs = {
      file: '/path/to/messages.html',
      callerName: 'Brook',
      chain: 'solana' as const,
      chatId: '12345',
      format: 'json' as const,
    };

    // Plain object context (minimal mock)
    const plainCtx = {
      services: {
        telegramIngestion: () => ({
          ingestExport: vi.fn().mockResolvedValue({
            alertsInserted: 10,
            callsInserted: 8,
            tokensUpserted: 5,
          }),
        }),
      },
    } as any;

    // Call handler directly (no Commander, no execute(), no CLI)
    const result = await ingestTelegramHandler(plainArgs, plainCtx);

    // Deterministic result
    expect(result).toEqual({
      alertsInserted: 10,
      callsInserted: 8,
      tokensUpserted: 5,
    });
  });

  it('returns the same result for the same inputs (deterministic)', async () => {
    const args1 = {
      file: '/path/to/messages.html',
      callerName: 'Lsy',
      chain: 'solana' as const,
      format: 'table' as const,
    };

    const args2 = { ...args1 }; // Same values, different object

    const mockResult = {
      alertsInserted: 5,
      callsInserted: 4,
      tokensUpserted: 3,
    };

    const ctx1 = {
      services: {
        telegramIngestion: () => ({
          ingestExport: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const ctx2 = {
      services: {
        telegramIngestion: () => ({
          ingestExport: vi.fn().mockResolvedValue(mockResult),
        }),
      },
    } as any;

    const result1 = await ingestTelegramHandler(args1, ctx1);
    const result2 = await ingestTelegramHandler(args2, ctx2);

    expect(result1).toEqual(result2);
    expect(result1).toEqual(mockResult);
  });
});

