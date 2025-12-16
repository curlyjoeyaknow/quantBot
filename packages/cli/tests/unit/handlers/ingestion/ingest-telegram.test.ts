/**
 * Unit tests for ingestTelegramHandler
 *
 * Tests that the handler is a pure use-case function:
 * - No Commander involved
 * - No output formatting
 * - No process.exit
 * - Dependencies are injected (fake context)
 * - Pure orchestration + correct parameter translation
 */

import { describe, it, expect, vi } from 'vitest';
import { ingestTelegramHandler } from '../../../../src/handlers/ingestion/ingest-telegram.js';

describe('ingestTelegramHandler', () => {
  it('calls TelegramAlertIngestionService.ingestExport with correct parameters', async () => {
    const ingestExport = vi.fn().mockResolvedValue({
      alertsInserted: 10,
      callsInserted: 8,
      tokensUpserted: 5,
    });

    const fakeCtx = {
      services: {
        telegramIngestion: () => ({ ingestExport }),
      },
    } as any;

    const args = {
      file: '/path/to/messages.html',
      callerName: 'Brook',
      chain: 'solana' as const,
      chatId: '12345',
      format: 'json' as const,
    };

    const result = await ingestTelegramHandler(args, fakeCtx);

    expect(ingestExport).toHaveBeenCalledTimes(1);
    expect(ingestExport).toHaveBeenCalledWith({
      filePath: args.file,
      callerName: args.callerName,
      chain: args.chain,
      chatId: args.chatId,
    });

    expect(result).toEqual({
      alertsInserted: 10,
      callsInserted: 8,
      tokensUpserted: 5,
    });
  });

  it('handles optional chatId parameter', async () => {
    const ingestExport = vi.fn().mockResolvedValue({
      alertsInserted: 5,
      callsInserted: 4,
      tokensUpserted: 3,
    });

    const fakeCtx = {
      services: {
        telegramIngestion: () => ({ ingestExport }),
      },
    } as any;

    const args = {
      file: '/path/to/messages.html',
      callerName: 'Lsy',
      chain: 'solana' as const,
      format: 'table' as const,
    };

    await ingestTelegramHandler(args, fakeCtx);

    const callArg = ingestExport.mock.calls[0][0];
    expect(callArg.chatId).toBeUndefined();
    expect(callArg.filePath).toBe(args.file);
    expect(callArg.callerName).toBe(args.callerName);
  });

  it('propagates service errors without catching them', async () => {
    const serviceError = new Error('Service failed: file not found');
    const ingestExport = vi.fn().mockRejectedValue(serviceError);

    const fakeCtx = {
      services: {
        telegramIngestion: () => ({ ingestExport }),
      },
    } as any;

    const args = {
      file: '/path/to/messages.html',
      callerName: 'Brook',
      chain: 'solana' as const,
      format: 'json' as const,
    };

    await expect(ingestTelegramHandler(args, fakeCtx)).rejects.toThrow(
      'Service failed: file not found'
    );
    expect(ingestExport).toHaveBeenCalledTimes(1);
  });
});
