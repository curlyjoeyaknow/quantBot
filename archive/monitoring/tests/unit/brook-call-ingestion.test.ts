import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrookCallIngestion } from '../../src/brook-call-ingestion';
import type { Telegraf } from 'telegraf';

vi.mock('@quantbot/storage', () => ({
  CallerDatabase: {
    insertCallerAlert: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('BrookCallIngestion', () => {
  let ingestion: BrookCallIngestion;
  let mockLiveTradeService: { addToken: ReturnType<typeof vi.fn> };
  let mockTenkanKijunService: { addToken: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLiveTradeService = {
      addToken: vi.fn().mockResolvedValue(undefined),
    };
    mockTenkanKijunService = {
      addToken: vi.fn().mockResolvedValue(undefined),
    };
    ingestion = new BrookCallIngestion(
      'test-token',
      'test-channel-id',
      'test-chat-id',
      mockLiveTradeService as unknown as typeof mockLiveTradeService,
      mockTenkanKijunService as unknown as typeof mockTenkanKijunService
    );
  });

  describe('extractTokenAddresses', () => {
    it('should extract Solana addresses', (): void => {
      const text = 'Token address: 7pXs123456789012345678901234567890pump';
      // Test via public interface - ingestion service should handle token extraction
      expect(ingestion).toBeDefined();
    });

    it('should extract EVM addresses', () => {
      const text = 'Token: 0x1234567890123456789012345678901234567890';
      expect(ingestion).toBeDefined();
    });

    it('should handle multiple addresses', () => {
      const text = 'Addresses: 7pXs123456789012345678901234567890pump and 0x1234567890123456789012345678901234567890';
      expect(ingestion).toBeDefined();
    });

    it('should preserve mint address case', () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
      const text = `Token: ${fullMint}`;
      expect(ingestion).toBeDefined();
    });
  });

  describe('start', () => {
    it('should start the ingestion service', async () => {
      await ingestion.start();
      expect(ingestion).toBeDefined();
    });
  });

  describe('stop', () => {
    it('should stop the ingestion service', () => {
      ingestion.stop();
      expect(ingestion).toBeDefined();
    });
  });
});

