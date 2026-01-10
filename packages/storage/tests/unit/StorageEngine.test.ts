/**
 * Comprehensive tests for StorageEngine
 *
 * Tests cover:
 * - OHLCV candle storage and retrieval
 * - Token calls storage and retrieval
 * - Strategies storage and retrieval
 * - Indicators storage and retrieval
 * - Simulation results storage
 * - Caching behavior
 * - Mint address preservation (CRITICAL)
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { StorageEngine } from '../../src/engine/StorageEngine';
import type {
  Candle,
  Call,
  StrategyConfig,
  SimulationResult,
  SimulationEvent,
} from '@quantbot/core';
import type { IndicatorValue } from '../../src/engine/StorageEngine';

// Mock all repositories
const mockOhlcvRepoInstance = {
  upsertCandles: vi.fn().mockResolvedValue(undefined),
  getCandles: vi.fn().mockResolvedValue([]),
};

const mockIndicatorsRepoInstance = {
  upsertIndicators: vi.fn().mockResolvedValue(undefined),
  getIndicators: vi.fn().mockResolvedValue(new Map()),
  getLatestIndicators: vi.fn().mockResolvedValue([]),
};

const mockCallsRepoInstance = {
  insertCall: vi.fn().mockResolvedValue(1),
  findByTokenId: vi.fn().mockResolvedValue([]),
  queryBySelection: vi.fn().mockResolvedValue([]),
};

const mockStrategiesRepoInstance = {
  create: vi.fn().mockResolvedValue(1),
  findAllActive: vi.fn().mockResolvedValue([]),
  findByName: vi.fn().mockResolvedValue(null),
};

const mockSimulationEventsRepoInstance = {
  insertEvents: vi.fn().mockResolvedValue(undefined),
};

const mockTokenMetadataRepoInstance = {
  upsertMetadata: vi.fn().mockResolvedValue(undefined),
  getLatestMetadata: vi.fn().mockResolvedValue(null),
  getMetadataHistory: vi.fn().mockResolvedValue([]),
};

const mockSimulationResultsRepoInstance = {
  upsertSummary: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../src/clickhouse/repositories/OhlcvRepository', () => ({
  OhlcvRepository: class {
    constructor() {
      return mockOhlcvRepoInstance;
    }
  },
}));

vi.mock('../../src/clickhouse/repositories/IndicatorsRepository', () => ({
  IndicatorsRepository: class {
    constructor() {
      return mockIndicatorsRepoInstance;
    }
  },
}));

vi.mock('../../src/clickhouse/repositories/SimulationEventsRepository', () => ({
  SimulationEventsRepository: class {
    constructor() {
      return mockSimulationEventsRepoInstance;
    }
  },
}));

vi.mock('../../src/clickhouse/repositories/TokenMetadataRepository', () => ({
  TokenMetadataRepository: class {
    constructor() {
      return mockTokenMetadataRepoInstance;
    }
  },
}));

vi.mock('../../src/postgres/repositories/CallsRepository', () => ({
  CallsRepository: class {
    constructor() {
      return mockCallsRepoInstance;
    }
  },
}));

vi.mock('../../src/postgres/repositories/StrategiesRepository', () => ({
  StrategiesRepository: class {
    constructor() {
      return mockStrategiesRepoInstance;
    }
  },
}));

vi.mock('../../src/postgres/repositories/SimulationResultsRepository', () => ({
  SimulationResultsRepository: class {
    constructor() {
      return mockSimulationResultsRepoInstance;
    }
  },
}));

vi.mock('../../src/postgres/repositories/TokensRepository', () => ({
  TokensRepository: class {
    constructor() {
      return {};
    }
  },
}));

vi.mock('../../src/postgres/repositories/AlertsRepository', () => ({
  AlertsRepository: class {
    constructor() {
      return {};
    }
  },
}));

vi.mock('../../src/postgres/repositories/CallersRepository', () => ({
  CallersRepository: class {
    constructor() {
      return {};
    }
  },
}));
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/utils')>('@quantbot/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    ValidationError: actual.ValidationError,
    ServiceUnavailableError: actual.ServiceUnavailableError,
    AppError: actual.AppError,
  };
});

// Mock Postgres client to avoid real DB connections
const mockPgPool = {
  query: vi.fn(),
  end: vi.fn(),
};

vi.mock('../../src/postgres/postgres-client', () => ({
  getPostgresPool: () => mockPgPool,
  getPostgresClient: () => ({ query: vi.fn(), release: vi.fn() }),
  closePostgresPool: vi.fn(),
  withPostgresTransaction: vi.fn(),
}));

describe('StorageEngine', () => {
  let engine: StorageEngine;

  // Full mint address for testing (CRITICAL: preserve exact case)
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';
  const FULL_MINT_UPPERCASE = '7PXS123456789012345678901234567890PUMP';

  beforeEach(() => {
    // Reset all mocks to their default state
    vi.clearAllMocks();
    mockOhlcvRepoInstance.upsertCandles.mockResolvedValue(undefined);
    mockOhlcvRepoInstance.getCandles.mockResolvedValue([]);
    mockIndicatorsRepoInstance.upsertIndicators.mockResolvedValue(undefined);
    mockIndicatorsRepoInstance.getIndicators.mockResolvedValue(new Map());
    mockCallsRepoInstance.insertCall.mockResolvedValue(1);
    mockCallsRepoInstance.findByTokenId.mockResolvedValue([]);
    mockCallsRepoInstance.queryBySelection.mockResolvedValue([]);
    mockStrategiesRepoInstance.create.mockResolvedValue(1);
    mockStrategiesRepoInstance.findAllActive.mockResolvedValue([]);
    mockStrategiesRepoInstance.findByName.mockResolvedValue(null);
    mockSimulationEventsRepoInstance.insertEvents.mockResolvedValue(undefined);
    mockSimulationResultsRepoInstance.upsertSummary.mockResolvedValue(undefined);

    engine = new StorageEngine({
      enableCache: true,
      cacheTTL: 1000, // 1 second for testing
      maxCacheSize: 10,
    });
  });

  afterEach(() => {
    if (engine) {
      engine.clearCache();
    }
  });

  describe('OHLCV Candles', () => {
    const mockCandles: Candle[] = [
      { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1500 },
    ];

    it('should store candles with full mint address preserved', async () => {
      await engine.storeCandles(FULL_MINT, 'solana', mockCandles, '5m');

      expect(mockOhlcvRepoInstance.upsertCandles).toHaveBeenCalledWith(
        FULL_MINT, // CRITICAL: Full address, exact case
        'solana',
        '5m',
        mockCandles
      );
    });

    it('should preserve exact case of mint address', async () => {
      await engine.storeCandles(FULL_MINT_LOWERCASE, 'solana', mockCandles, '5m');
      expect(mockOhlcvRepoInstance.upsertCandles).toHaveBeenCalledWith(
        FULL_MINT_LOWERCASE, // Exact case preserved
        'solana',
        '5m',
        mockCandles
      );

      await engine.storeCandles(FULL_MINT_UPPERCASE, 'solana', mockCandles, '5m');
      expect(mockOhlcvRepoInstance.upsertCandles).toHaveBeenCalledWith(
        FULL_MINT_UPPERCASE, // Exact case preserved
        'solana',
        '5m',
        mockCandles
      );
    });

    it('should retrieve candles with caching', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      mockOhlcvRepoInstance.getCandles.mockResolvedValue(mockCandles);

      const result1 = await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);
      const result2 = await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);

      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(1); // Cached on second call
      expect(result1).toEqual(mockCandles);
      expect(result2).toEqual(mockCandles);
    });

    it('should bypass cache when forceRefresh is true', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      mockOhlcvRepoInstance.getCandles.mockResolvedValue(mockCandles);

      await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);
      await engine.getCandles(FULL_MINT, 'solana', startTime, endTime, { forceRefresh: true });

      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(2);
    });

    it('should handle empty candle arrays', async () => {
      await engine.storeCandles(FULL_MINT, 'solana', [], '5m');
      expect(mockOhlcvRepoInstance.upsertCandles).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockOhlcvRepoInstance.upsertCandles.mockRejectedValue(new Error('Database error'));

      await expect(engine.storeCandles(FULL_MINT, 'solana', mockCandles, '5m')).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('Token Calls', () => {
    const mockCall: Omit<Call, 'id' | 'createdAt'> = {
      tokenId: 1,
      callerId: 2,
      side: 'buy',
      signalType: 'entry',
      signalTimestamp: DateTime.now(),
      signalStrength: 0.8,
    };

    it('should store a call', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB repositories directly
      await expect(engine.storeCall(mockCall)).rejects.toThrow(
        'storeCall is not available. PostgreSQL has been removed. Use DuckDB repositories directly.'
      );
    });

    it('should retrieve calls by token', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB repositories directly
      await expect(engine.getCallsByToken(1)).rejects.toThrow(
        'getCallsByToken is not available. PostgreSQL has been removed. Use DuckDB repositories directly.'
      );
    });

    it('should retrieve calls by caller', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB repositories directly
      await expect(engine.getCallsByCaller(2)).rejects.toThrow(
        'getCallsByCaller is not available. PostgreSQL has been removed. Use DuckDB repositories directly.'
      );
    });

    it('should cache calls', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB repositories directly
      await expect(engine.getCallsByToken(1)).rejects.toThrow(
        'getCallsByToken is not available. PostgreSQL has been removed. Use DuckDB repositories directly.'
      );

      // Repository should not be called since method throws immediately
      expect(mockCallsRepoInstance.findByTokenId).not.toHaveBeenCalled();
    });
  });

  describe('Strategies', () => {
    const mockStrategy: Omit<StrategyConfig, 'createdAt' | 'updatedAt'> = {
      name: 'test_strategy',
      version: '1',
      config: { entry: { type: 'price_drop', percent: 10 } },
      isActive: true,
    };

    it('should store a strategy', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB StrategiesRepository directly
      await expect(engine.storeStrategy(mockStrategy)).rejects.toThrow(
        'storeStrategy is not available. PostgreSQL has been removed. Use DuckDB StrategiesRepository directly.'
      );
    });

    it('should retrieve active strategies', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB StrategiesRepository directly
      await expect(engine.getActiveStrategies()).rejects.toThrow(
        'getActiveStrategies is not available. PostgreSQL has been removed. Use DuckDB StrategiesRepository directly.'
      );
    });

    it('should retrieve strategy by name', async () => {
      // Method is deprecated - PostgreSQL removed, use DuckDB StrategiesRepository directly
      await expect(engine.getStrategy('test_strategy', '1')).rejects.toThrow(
        'getStrategy is not available. PostgreSQL has been removed. Use DuckDB StrategiesRepository directly.'
      );
    });
  });

  describe('Indicators', () => {
    const mockIndicators: IndicatorValue[] = [
      {
        indicatorType: 'ichimoku',
        value: { tenkan: 0.001, kijun: 0.0012, senkouA: 0.0011, senkouB: 0.0013 },
        timestamp: 1000,
      },
    ];

    it('should store indicators with full mint address preserved', async () => {
      await engine.storeIndicators(FULL_MINT, 'solana', 1000, mockIndicators);

      expect(mockIndicatorsRepoInstance.upsertIndicators).toHaveBeenCalledWith(
        FULL_MINT, // CRITICAL: Full address, exact case
        'solana',
        1000,
        mockIndicators
      );
    });

    it('should preserve exact case of mint address for indicators', async () => {
      await engine.storeIndicators(FULL_MINT_LOWERCASE, 'solana', 1000, mockIndicators);
      expect(mockIndicatorsRepoInstance.upsertIndicators).toHaveBeenCalledWith(
        FULL_MINT_LOWERCASE,
        'solana',
        1000,
        mockIndicators
      );
    });

    it('should retrieve indicators', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      const indicatorsMap = new Map<number, IndicatorValue[]>([[1000, mockIndicators]]);
      mockIndicatorsRepoInstance.getIndicators.mockResolvedValue(indicatorsMap);

      const result = await engine.getIndicators(FULL_MINT, 'solana', startTime, endTime);

      expect(mockIndicatorsRepoInstance.getIndicators).toHaveBeenCalledWith(
        FULL_MINT,
        'solana',
        startTime,
        endTime,
        undefined
      );
      expect(result).toEqual(indicatorsMap);
    });

    it('should handle empty indicator arrays', async () => {
      await engine.storeIndicators(FULL_MINT, 'solana', 1000, []);
      expect(mockIndicatorsRepoInstance.upsertIndicators).not.toHaveBeenCalled();
    });
  });

  describe('Simulation Results', () => {
    const mockResult: SimulationResult = {
      finalPnl: 100.5,
      events: [],
      entryPrice: 1.0,
      finalPrice: 1.1,
      totalCandles: 100,
      entryOptimization: {
        lowestPrice: 0.9,
        lowestPriceTimestamp: 1000,
        lowestPricePercent: 10,
        lowestPriceTimeFromEntry: 60,
        trailingEntryUsed: true,
        actualEntryPrice: 0.9,
        entryDelay: 60,
      },
    };

    const mockEvents: SimulationEvent[] = [
      {
        type: 'entry',
        timestamp: 1000,
        price: 1.0,
        description: 'Entry',
        remainingPosition: 1.0,
        pnlSoFar: 0,
      },
    ];

    it('should store simulation results summary', async () => {
      // Method is deprecated - PostgreSQL removed, only ClickHouse event storage available
      // With empty events array, it just logs a warning and doesn't throw
      await engine.storeSimulationResults(1, mockResult);

      // Should not throw, but also should not call any repository (PostgreSQL removed)
      expect(mockSimulationResultsRepoInstance.upsertSummary).not.toHaveBeenCalled();
    });

    it('should store simulation events with full mint address preserved', async () => {
      await engine.storeSimulationEvents(1, FULL_MINT, 'solana', mockEvents);

      expect(mockSimulationEventsRepoInstance.insertEvents).toHaveBeenCalledWith(
        1,
        FULL_MINT, // CRITICAL: Full address, exact case
        'solana',
        mockEvents
      );
    });

    it('should handle empty events array', async () => {
      await engine.storeSimulationEvents(1, FULL_MINT, 'solana', []);
      expect(mockSimulationEventsRepoInstance.insertEvents).not.toHaveBeenCalled();
    });
  });

  describe('Caching', () => {
    it('should cache data with TTL', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      const mockCandles: Candle[] = [];
      mockOhlcvRepoInstance.getCandles.mockResolvedValue(mockCandles);

      await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);
      await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);

      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(1);
    });

    it('should respect maxCacheSize', async () => {
      engine = new StorageEngine({
        enableCache: true,
        cacheTTL: 10000,
        maxCacheSize: 2,
      });

      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      mockOhlcvRepoInstance.getCandles.mockResolvedValue([]);

      // Fill cache beyond max size
      await engine.getCandles('token1', 'solana', startTime, endTime);
      await engine.getCandles('token2', 'solana', startTime, endTime);
      await engine.getCandles('token3', 'solana', startTime, endTime);

      const stats = engine.getCacheStats();
      expect(stats.size).toBeLessThanOrEqual(2);
    });

    it('should clear cache', () => {
      engine.clearCache();
      const stats = engine.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should get cache statistics', () => {
      const stats = engine.getCacheStats();
      expect(stats).toHaveProperty('size');
      expect(stats).toHaveProperty('maxSize');
      expect(stats.maxSize).toBe(10);
    });

    it('should expire cache entries after TTL using deterministic clock', async () => {
      // Use deterministic clock for predictable TTL testing
      let currentTime = 1000000; // Fixed starting time
      const testClock = {
        nowMs: () => currentTime,
      };

      const engineWithClock = new StorageEngine({
        enableCache: true,
        cacheTTL: 100, // 100ms TTL
        maxCacheSize: 10,
        clock: testClock,
      });

      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      const mockCandles: Candle[] = [
        {
          timestamp: 1000,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      mockOhlcvRepoInstance.getCandles.mockResolvedValue(mockCandles);

      // First call - should cache
      await engineWithClock.getCandles(FULL_MINT, 'solana', startTime, endTime);
      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      mockOhlcvRepoInstance.getCandles.mockClear();
      await engineWithClock.getCandles(FULL_MINT, 'solana', startTime, endTime);
      expect(mockOhlcvRepoInstance.getCandles).not.toHaveBeenCalled();

      // Advance clock past TTL
      currentTime += 101; // 101ms > 100ms TTL

      // Third call - cache should be expired, should call repository again
      await engineWithClock.getCandles(FULL_MINT, 'solana', startTime, endTime);
      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache on writes', async () => {
      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      mockOhlcvRepoInstance.getCandles.mockResolvedValue([]);

      // Cache some data
      await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);

      // Write should invalidate cache (use non-empty candles to trigger invalidation)
      await engine.storeCandles(
        FULL_MINT,
        'solana',
        [{ timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
        '5m'
      );

      // Next read should hit repository again
      await engine.getCandles(FULL_MINT, 'solana', startTime, endTime);

      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(2);
    });
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const defaultEngine = new StorageEngine();
      const stats = defaultEngine.getCacheStats();
      expect(stats.maxSize).toBe(1000); // Default
    });

    it('should respect custom configuration', () => {
      const customEngine = new StorageEngine({
        enableCache: false,
        cacheTTL: 5000,
        maxCacheSize: 100,
      });

      const stats = customEngine.getCacheStats();
      expect(stats.maxSize).toBe(100);
    });

    it('should disable caching when enableCache is false', async () => {
      const noCacheEngine = new StorageEngine({
        enableCache: false,
      });

      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);
      mockOhlcvRepoInstance.getCandles.mockResolvedValue([]);

      await noCacheEngine.getCandles(FULL_MINT, 'solana', startTime, endTime);
      await noCacheEngine.getCandles(FULL_MINT, 'solana', startTime, endTime);

      // Should call repository twice (no caching)
      expect(mockOhlcvRepoInstance.getCandles).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should propagate errors from repositories', async () => {
      mockOhlcvRepoInstance.upsertCandles.mockRejectedValue(new Error('ClickHouse error'));

      await expect(
        engine.storeCandles(
          FULL_MINT,
          'solana',
          [{ timestamp: 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }],
          '5m'
        )
      ).rejects.toThrow('ClickHouse error');
    });

    it('should handle repository errors gracefully in get operations', async () => {
      mockOhlcvRepoInstance.getCandles.mockRejectedValue(new Error('Query error'));

      const startTime = DateTime.fromSeconds(1000);
      const endTime = DateTime.fromSeconds(2000);

      await expect(engine.getCandles(FULL_MINT, 'solana', startTime, endTime)).rejects.toThrow(
        'Query error'
      );
    });
  });
});
