import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { TelegramAlertIngestionService } from '../src/TelegramAlertIngestionService';

// Mock the multi-chain metadata service
vi.mock('../src/MultiChainMetadataService', () => ({
  fetchMultiChainMetadata: vi.fn().mockResolvedValue({
    addressKind: 'solana',
    primaryMetadata: {
      chain: 'solana',
      name: 'Test Token',
      symbol: 'TEST',
      found: true,
    },
    metadata: [],
  }),
}));

// Mock api-clients
vi.mock('@quantbot/api-clients', () => ({
  getBirdeyeClient: vi.fn(() => ({
    getTokenMetadata: vi.fn().mockResolvedValue({ name: 'Test Token', symbol: 'TEST' }),
  })),
}));

describe('TelegramAlertIngestionService', () => {
  const callersRepo = { getOrCreateCaller: vi.fn() };
  const tokensRepo = { getOrCreateToken: vi.fn() };
  const alertsRepo = { insertAlert: vi.fn() };
  const callsRepo = { insertCall: vi.fn() };

  const service = new TelegramAlertIngestionService(
    callersRepo as any,
    tokensRepo as any,
    alertsRepo as any,
    callsRepo as any
  );

  beforeEach(() => {
    vi.clearAllMocks();
    callersRepo.getOrCreateCaller.mockResolvedValue({ id: 10 });
    tokensRepo.getOrCreateToken.mockImplementation(async (_chain: any, address: string) => ({
      id: address.length,
      address,
    }));
    alertsRepo.insertAlert.mockResolvedValue(100);
    callsRepo.insertCall.mockResolvedValue(200);
  });

  it('ingests messages and inserts alerts and calls', async () => {
    // Minimal HTML export with caller message followed by bot response
    const mockFile = '/tmp/mock-export.html';
    const fs = await import('fs');
    const html = `
      <div class="message" id="message1">
        <div class="from_name">TestUser</div>
        <div class="text">Check this token!</div>
        <div class="date" title="2024-01-15 10:30:00"></div>
      </div>
      <div class="message" id="message2">
        <div class="from_name">Rick</div>
        <div class="text">Token: Test Token ($TEST) CA: So11111111111111111111111111111111111111112 MC: $100K Price: $0.001</div>
        <div class="date" title="2024-01-15 10:30:05"></div>
      </div>
    `;
    fs.writeFileSync(mockFile, html, 'utf8');

    const result = await service.ingestExport({
      filePath: mockFile,
      callerName: 'testcaller',
      chain: 'solana',
    });

    expect(result.alertsInserted).toBeGreaterThanOrEqual(1);
    expect(result.callsInserted).toBeGreaterThanOrEqual(1);
    expect(result.tokensUpserted).toBeGreaterThanOrEqual(1);

    fs.unlinkSync(mockFile);
  });
});
