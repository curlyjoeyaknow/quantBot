import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResultsService } from '../../src/services/results-service';
import { ohlcvService } from '../../src/services/ohlcv-service';

// Mock sqlite3
const mockDbInstance = {
  all: vi.fn(),
  get: vi.fn(),
  close: vi.fn(),
};

vi.mock('sqlite3', () => {
  class MockDatabase {
    all = mockDbInstance.all;
    get = mockDbInstance.get;
    close = mockDbInstance.close;

    constructor(path: string, callback?: (err: Error | null) => void) {
      if (callback) {
        setTimeout(() => callback(null), 0);
      }
    }
  }

  return {
    Database: MockDatabase,
  };
});

// Mock ohlcvService
vi.mock('../../src/services/ohlcv-service', () => ({
  ohlcvService: {
    getCandles: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('results-service', () => {
  let service: ResultsService;

  beforeEach(() => {
    service = new ResultsService();
    vi.clearAllMocks();
  });

  describe('aggregateResults', () => {
    it('should return empty metrics for empty runIds', async () => {
      const result = await service.aggregateResults([]);

      expect(result.metrics.totalRuns).toBe(0);
      expect(result.runs).toEqual([]);
    });

    it('should aggregate results from multiple runs', async () => {
      const mockRows = [
        {
          id: 1,
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          token_name: 'Test Token',
          token_symbol: 'TEST',
          final_pnl: 1.1,
          total_candles: 100,
          entry_price: 1.0,
          entry_timestamp: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 2,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          chain: 'solana',
          token_name: 'USDC',
          token_symbol: 'USDC',
          final_pnl: 0.9,
          total_candles: 200,
          entry_price: 1.0,
          entry_timestamp: '2024-01-02T00:00:00Z',
          created_at: '2024-01-02T00:00:00Z',
        },
      ];

      mockDbInstance.all.mockImplementation((query, params, callback) => {
        callback(null, mockRows);
      });

      const result = await service.aggregateResults([1, 2]);

      expect(result.runs).toHaveLength(2);
      expect(result.metrics.totalRuns).toBe(2);
      expect(result.metrics.averagePnl).toBeCloseTo(1.0, 1);
    });

    it('should handle database errors', async () => {
      mockDbInstance.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(service.aggregateResults([1])).rejects.toThrow('Database error');
    });
  });

  describe('generateChartData', () => {
    it('should generate chart data for a run', async () => {
      const mockRun = {
        id: 1,
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        start_time: '2024-01-01T00:00:00Z',
        end_time: '2024-01-02T00:00:00Z',
      };

      const mockEvents = [
        {
          timestamp: 1000,
          event_type: 'entry',
          pnl_so_far: 0,
        },
        {
          timestamp: 2000,
          event_type: 'target_hit',
          pnl_so_far: 1.1,
        },
      ];

      const mockCandles = [
        { timestamp: 1000, close: 1.0 },
        { timestamp: 2000, close: 1.1 },
      ];

      mockDbInstance.get.mockImplementation((query, params, callback) => {
        callback(null, mockRun);
      });

      mockDbInstance.all.mockImplementation((query, params, callback) => {
        callback(null, mockEvents);
      });

      vi.mocked(ohlcvService.getCandles).mockResolvedValue(mockCandles as any);

      const result = await service.generateChartData(1);

      expect(result.priceChart).toBeDefined();
      expect(result.pnlChart).toBeDefined();
      expect(result.tradeDistribution).toBeDefined();
    });

    it('should handle run not found', async () => {
      mockDbInstance.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await expect(service.generateChartData(999)).rejects.toThrow('Run not found');
    });
  });

  describe('compareStrategies', () => {
    it('should compare multiple strategies', async () => {
      const mockStrategies = [
        { id: 1, name: 'Strategy 1' },
        { id: 2, name: 'Strategy 2' },
      ];

      mockDbInstance.all.mockImplementation((query, params, callback) => {
        if (query.includes('strategies')) {
          callback(null, mockStrategies);
        } else if (query.includes('simulation_runs')) {
          callback(null, [
            { final_pnl: 1.1, total_candles: 100 },
            { final_pnl: 0.9, total_candles: 200 },
          ]);
        }
      });

      const result = await service.compareStrategies([1, 2], 123);

      expect(result.strategies).toHaveLength(2);
      expect(result.strategies[0].metrics.totalRuns).toBe(2);
    });
  });
});

