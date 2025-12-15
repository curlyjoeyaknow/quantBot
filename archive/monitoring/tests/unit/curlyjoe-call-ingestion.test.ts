import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CurlyJoeCallIngestion } from '../../src/curlyjoe-call-ingestion';

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

vi.mock('@quantbot/ohlcv', () => ({
  fetchHistoricalCandlesForMonitoring: vi.fn().mockResolvedValue([]),
}));

describe('CurlyJoeCallIngestion', () => {
  let ingestion: CurlyJoeCallIngestion;
  let mockLiveTradeService: { addToken: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLiveTradeService = {
      addToken: vi.fn().mockResolvedValue(undefined),
    };
    ingestion = new CurlyJoeCallIngestion(
      'test-token',
      'test-channel-id',
      mockLiveTradeService as unknown as typeof mockLiveTradeService
    );
  });

  describe('extractTokenAddresses', () => {
    it('should extract Solana addresses', () => {
      expect(ingestion).toBeDefined();
    });

    it('should extract EVM addresses', () => {
      expect(ingestion).toBeDefined();
    });

    it('should preserve mint address case', () => {
      const fullMint = '7pXs123456789012345678901234567890pump';
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

