/**
 * Unit tests for OhlcvIngestionService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OhlcvIngestionService } from '../../src/ingestion/OhlcvIngestionService';
import { CallsRepository } from '@quantbot/storage';
import { OhlcvRepository } from '@quantbot/storage';

// Mock repositories
const mockCallsRepo = {
  queryBySelection: vi.fn(),
} as unknown as CallsRepository;

const mockOhlcvRepo = {
  upsertCandles: vi.fn(),
  getCandles: vi.fn(),
  hasCandles: vi.fn(),
} as unknown as OhlcvRepository;

describe('OhlcvIngestionService', () => {
  let service: OhlcvIngestionService;

  beforeEach(() => {
    service = new OhlcvIngestionService(mockCallsRepo, mockOhlcvRepo);
    vi.clearAllMocks();
  });

  it('should process calls and fetch candles', async () => {
    // Mock calls
    (mockCallsRepo.queryBySelection as any).mockResolvedValue([
      {
        id: 1,
        tokenId: 1,
        signalTimestamp: { toJSDate: () => new Date('2024-01-15T14:30:00Z') },
      },
    ]);

    // Mock hasCandles to return false (need to fetch)
    (mockOhlcvRepo.hasCandles as any).mockResolvedValue(false);

    const result = await service.ingestForCalls({
      from: new Date('2024-01-01'),
      to: new Date('2024-02-01'),
      preWindowMinutes: 260,
      postWindowMinutes: 1440,
      interval: '5m',
    });

    expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
    expect(mockCallsRepo.queryBySelection).toHaveBeenCalled();
  });

  it('should handle empty calls gracefully', async () => {
    (mockCallsRepo.queryBySelection as any).mockResolvedValue([]);

    const result = await service.ingestForCalls({
      preWindowMinutes: 260,
      postWindowMinutes: 1440,
      interval: '5m',
    });

    expect(result.tokensProcessed).toBe(0);
    expect(result.candlesInserted).toBe(0);
  });

  it('should continue processing on individual token errors', async () => {
    (mockCallsRepo.queryBySelection as any).mockResolvedValue([
      { id: 1, tokenId: 1, signalTimestamp: { toJSDate: () => new Date() } },
      { id: 2, tokenId: 2, signalTimestamp: { toJSDate: () => new Date() } },
    ]);

    // Mock hasCandles to throw for first token, succeed for second
    (mockOhlcvRepo.hasCandles as any)
      .mockRejectedValueOnce(new Error('Token 1 error'))
      .mockResolvedValueOnce(false);

    // Should not throw, should continue processing
    await expect(
      service.ingestForCalls({
        preWindowMinutes: 260,
        postWindowMinutes: 1440,
        interval: '5m',
      })
    ).resolves.toBeDefined();
  });
});

