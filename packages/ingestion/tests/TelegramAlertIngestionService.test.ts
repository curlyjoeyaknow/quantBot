import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { TelegramAlertIngestionService } from '../src/TelegramAlertIngestionService';

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
    // Minimal HTML export with two messages containing mints
    const mockFile = '/tmp/mock-export.html';
    const fs = await import('fs');
    const html = `
      <div class="message" id="message1">
        <div class="from_name">User</div>
        <div class="text">Mint: So11111111111111111111111111111111111111112</div>
        <div class="date" title="2024-01-15 10:30:00"></div>
      </div>
      <div class="message" id="message2">
        <div class="from_name">User</div>
        <div class="text">Another 7pXs123456789012345678901234567890pump</div>
        <div class="date" title="2024-01-15 10:35:00"></div>
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
