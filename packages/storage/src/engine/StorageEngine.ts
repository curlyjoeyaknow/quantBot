/**
 * Unified Storage Engine for QuantBot
 *
 * Provides a single, robust interface for storing and retrieving:
 * - OHLCV candles (ClickHouse)
 * - Token calls (DuckDB)
 * - Strategies (DuckDB)
 * - Indicators (ClickHouse for computed values)
 * - Simulation results (ClickHouse)
 *
 * This engine abstracts the complexity of multi-database storage and provides
 * intelligent caching, query optimization, and data consistency guarantees.
 *
 * Note: Some methods that previously used PostgreSQL have been removed.
 * Use DuckDB repositories directly for token calls, strategies, and callers.
 */

import { DateTime } from 'luxon';
import { logger, ValidationError } from '@quantbot/utils';
import type {
  Chain,
  Candle,
  Call,
  StrategyConfig,
  SimulationResult,
  SimulationEvent,
  Alert,
  TokenMetadata,
} from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';
import type { TokenMetadataSnapshot } from '../clickhouse/repositories/TokenMetadataRepository';

// Import repositories
import { OhlcvRepository } from '../clickhouse/repositories/OhlcvRepository';
import { SimulationEventsRepository } from '../clickhouse/repositories/SimulationEventsRepository';

// Import indicator storage
import { IndicatorsRepository } from '../clickhouse/repositories/IndicatorsRepository';

// Import token metadata storage
import { TokenMetadataRepository } from '../clickhouse/repositories/TokenMetadataRepository';

/**
 * Storage engine configuration
 */
export interface StorageEngineConfig {
  /**
   * Enable in-memory caching for frequently accessed data
   * @default true
   */
  enableCache?: boolean;

  /**
   * Cache TTL in milliseconds
   * @default 60000 (1 minute)
   */
  cacheTTL?: number;

  /**
   * Maximum cache size (number of entries)
   * @default 1000
   */
  maxCacheSize?: number;

  /**
   * Enable automatic indicator computation and storage
   * @default true
   */
  autoComputeIndicators?: boolean;
}

/**
 * Query options for OHLCV candles
 */
export interface OHLCVQueryOptions {
  /**
   * Candle interval (1m, 5m, 15m, 1h, etc.)
   * @default '5m'
   */
  interval?: string;

  /**
   * Use cache if available
   * @default true
   */
  useCache?: boolean;

  /**
   * Force refresh from source
   * @default false
   */
  forceRefresh?: boolean;
}

/**
 * Indicator computation result
 */
export interface IndicatorValue {
  indicatorType: string;
  value: number | Record<string, number>;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Indicator query options
 */
export interface IndicatorQueryOptions {
  /**
   * Indicator types to retrieve (e.g., ['ichimoku', 'ema', 'rsi'])
   * If not specified, returns all available indicators
   */
  indicatorTypes?: string[];

  /**
   * Use cache if available
   * @default true
   */
  useCache?: boolean;

  /**
   * Force recomputation
   * @default false
   */
  forceRecompute?: boolean;
}

/**
 * Simulation run metadata
 */
export interface SimulationRunMetadata {
  id?: number;
  strategyId?: number;
  tokenId?: number;
  callerId?: number;
  runType: 'backtest' | 'optimization' | 'live';
  engineVersion: string;
  configHash: string;
  config: Record<string, unknown>;
  dataSelection: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: DateTime;
  completedAt?: DateTime;
  errorMessage?: string;
}

/**
 * Unified Storage Engine
 */
export class StorageEngine {
  private readonly ohlcvRepo: OhlcvRepository;
  private readonly indicatorsRepo: IndicatorsRepository;
  private readonly tokenMetadataRepo: TokenMetadataRepository;
  private readonly simulationEventsRepo: SimulationEventsRepository;

  private readonly config: Required<StorageEngineConfig>;
  private readonly cache: Map<string, { data: unknown; timestamp: number }>;
  private cacheCleanupInterval?: NodeJS.Timeout;

  constructor(config: StorageEngineConfig = {}) {
    this.config = {
      enableCache: config.enableCache ?? true,
      cacheTTL: config.cacheTTL ?? 60000, // 1 minute
      maxCacheSize: config.maxCacheSize ?? 1000,
      autoComputeIndicators: config.autoComputeIndicators ?? true,
    };

    // Initialize repositories
    this.ohlcvRepo = new OhlcvRepository();
    this.indicatorsRepo = new IndicatorsRepository();
    this.tokenMetadataRepo = new TokenMetadataRepository();
    this.simulationEventsRepo = new SimulationEventsRepository();

    // Initialize cache
    this.cache = new Map();

    // Start cache cleanup interval
    if (this.config.enableCache) {
      this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), this.config.cacheTTL);
    }
  }

  // ============================================================================
  // OHLCV Candles
  // ============================================================================

  /**
   * Store OHLCV candles
   * CRITICAL: Preserves full mint address and exact case
   */
  async storeCandles(
    tokenAddress: string,
    chain: string,
    candles: Candle[],
    interval: string = '5m'
  ): Promise<void> {
    if (candles.length === 0) return;

    try {
      await this.ohlcvRepo.upsertCandles(tokenAddress, chain, interval, candles);

      // Invalidate cache for this token/interval
      if (this.config.enableCache) {
        this.invalidateCache(`candles:${tokenAddress}:${chain}:${interval}`);
      }

      logger.debug('Stored candles', {
        token: tokenAddress.substring(0, 20) + '...',
        chain,
        interval,
        count: candles.length,
      });
    } catch (error) {
      logger.error('Error storing candles', error as Error, {
        token: tokenAddress.substring(0, 20) + '...',
      });
      throw error;
    }
  }

  /**
   * Retrieve OHLCV candles for a token in a time range
   * CRITICAL: Uses full mint address, case-preserved
   *
   * Supports multiple intervals: '1m', '5m', '15m', '1h', '4h', '1d'
   */
  async getCandles(
    tokenAddress: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    options: OHLCVQueryOptions = {}
  ): Promise<Candle[]> {
    const { interval = '5m', useCache = true, forceRefresh = false } = options;

    // Validate interval
    const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
    if (!validIntervals.includes(interval)) {
      throw new ValidationError(
        `Invalid interval: ${interval}. Must be one of: ${validIntervals.join(', ')}`,
        { interval, validIntervals }
      );
    }

    const cacheKey = `candles:${tokenAddress}:${chain}:${interval}:${startTime.toISO()}:${endTime.toISO()}`;

    // Check cache first
    if (useCache && !forceRefresh && this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        logger.debug('Using cached candles', {
          token: tokenAddress.substring(0, 20) + '...',
          interval,
        });
        return cached.data as Candle[];
      }
    }

    try {
      const candles = await this.ohlcvRepo.getCandles(tokenAddress, chain, interval, {
        from: startTime,
        to: endTime,
      });

      // Store in cache
      if (useCache && this.config.enableCache) {
        this.setCache(cacheKey, candles);
      }

      return candles;
    } catch (error) {
      logger.error('Error retrieving candles', error as Error, {
        token: tokenAddress.substring(0, 20) + '...',
        interval,
      });
      throw error;
    }
  }

  /**
   * Get candles for multiple intervals (e.g., 1m for precision, 5m for overview)
   * Returns a map of interval -> candles
   */
  async getCandlesMultiInterval(
    tokenAddress: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    intervals: string[],
    options: Omit<OHLCVQueryOptions, 'interval'> = {}
  ): Promise<Map<string, Candle[]>> {
    const results = new Map<string, Candle[]>();

    // Fetch all intervals in parallel
    const promises = intervals.map(async (interval) => {
      try {
        const candles = await this.getCandles(tokenAddress, chain, startTime, endTime, {
          ...options,
          interval,
        });
        return { interval, candles };
      } catch (error) {
        logger.error('Error fetching candles for interval', error as Error, {
          token: tokenAddress.substring(0, 20) + '...',
          interval,
        });
        return { interval, candles: [] };
      }
    });

    const resultsArray = await Promise.all(promises);
    resultsArray.forEach(({ interval, candles }) => {
      results.set(interval, candles);
    });

    return results;
  }

  // ============================================================================
  // Caller Alerts
  // ============================================================================

  /**
   * Store a caller alert with initial market cap and price
   * @deprecated PostgreSQL removed. Use DuckDB repositories directly.
   */
  async storeCallerAlert(
    _tokenAddress: string,
    _chain: string,
    _callerId: number,
    _alertTimestamp: DateTime,
    _data: {
      alertPrice?: number;
      initialMcap?: number;
      initialPrice?: number;
      confidence?: number;
      chatId?: string;
      messageId?: string;
      messageText?: string;
      rawPayload?: Record<string, unknown>;
    }
  ): Promise<number> {
    throw new Error('storeCallerAlert is not available. PostgreSQL has been removed. Use DuckDB repositories directly.');
  }

  /**
   * Update caller alert metrics (time to ATH, max ROI)
   * @deprecated PostgreSQL removed. Use DuckDB repositories directly.
   */
  async updateCallerAlertMetrics(
    _alertId: number,
    _metrics: {
      timeToATH?: number;
      maxROI?: number;
      athPrice?: number;
      athTimestamp?: DateTime;
    }
  ): Promise<void> {
    throw new Error('updateCallerAlertMetrics is not available. PostgreSQL has been removed. Use DuckDB repositories directly.');
  }

  /**
   * Get caller alerts with metrics
   * @deprecated PostgreSQL removed. Use DuckDB repositories directly.
   */
  async getCallerAlerts(
    _callerId: number,
    _options?: { from?: DateTime; to?: DateTime; limit?: number }
  ): Promise<
    Array<
      Alert & {
        initialMcap?: number;
        initialPrice?: number;
        timeToATH?: number;
        maxROI?: number;
        athPrice?: number;
        athTimestamp?: DateTime;
      }
    >
  > {
    throw new Error('getCallerAlerts is not available. PostgreSQL has been removed. Use DuckDB repositories directly.');
  }

  // ============================================================================
  // Token Calls
  // ============================================================================

  /**
   * Store a token call
   * @deprecated PostgreSQL removed. Use DuckDB repositories directly.
   */
  async storeCall(_call: Omit<Call, 'id' | 'createdAt'>): Promise<number> {
    throw new Error('storeCall is not available. PostgreSQL has been removed. Use DuckDB repositories directly.');
  }

  /**
   * Retrieve calls by token
   * @deprecated PostgreSQL removed. Use DuckDB repositories directly.
   */
  async getCallsByToken(
    _tokenId: number,
    _options?: { from?: DateTime; to?: DateTime; limit?: number }
  ): Promise<Call[]> {
    throw new Error('getCallsByToken is not available. PostgreSQL has been removed. Use DuckDB repositories directly.');
  }

  /**
   * Retrieve calls by caller
   * @deprecated PostgreSQL removed. Use DuckDB repositories directly.
   */
  async getCallsByCaller(
    _callerId: number,
    _options?: { from?: DateTime; to?: DateTime; limit?: number }
  ): Promise<Call[]> {
    throw new Error('getCallsByCaller is not available. PostgreSQL has been removed. Use DuckDB repositories directly.');
  }

  // ============================================================================
  // Strategies
  // ============================================================================

  /**
   * Store a strategy
   * @deprecated PostgreSQL removed. Use DuckDB StrategiesRepository directly.
   */
  async storeStrategy(_strategy: Omit<StrategyConfig, 'createdAt' | 'updatedAt'>): Promise<number> {
    throw new Error('storeStrategy is not available. PostgreSQL has been removed. Use DuckDB StrategiesRepository directly.');
  }

  /**
   * Retrieve all active strategies
   * @deprecated PostgreSQL removed. Use DuckDB StrategiesRepository directly.
   */
  async getActiveStrategies(): Promise<StrategyConfig[]> {
    throw new Error('getActiveStrategies is not available. PostgreSQL has been removed. Use DuckDB StrategiesRepository directly.');
  }

  /**
   * Retrieve strategy by name
   * @deprecated PostgreSQL removed. Use DuckDB StrategiesRepository directly.
   */
  async getStrategy(_name: string, _version?: string): Promise<StrategyConfig | null> {
    throw new Error('getStrategy is not available. PostgreSQL has been removed. Use DuckDB StrategiesRepository directly.');
  }

  // ============================================================================
  // Indicators
  // ============================================================================

  /**
   * Store computed indicator values
   */
  async storeIndicators(
    tokenAddress: string,
    chain: string,
    timestamp: number,
    indicators: IndicatorValue[]
  ): Promise<void> {
    if (indicators.length === 0) return;

    try {
      await this.indicatorsRepo.upsertIndicators(tokenAddress, chain, timestamp, indicators);

      // Invalidate cache
      if (this.config.enableCache) {
        this.invalidateCache(`indicators:${tokenAddress}:${chain}`);
      }

      logger.debug('Stored indicators', {
        token: tokenAddress.substring(0, 20) + '...',
        count: indicators.length,
      });
    } catch (error) {
      logger.error('Error storing indicators', error as Error);
      throw error;
    }
  }

  /**
   * Retrieve indicator values for a token in a time range
   */
  async getIndicators(
    tokenAddress: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime,
    options: IndicatorQueryOptions = {}
  ): Promise<Map<number, IndicatorValue[]>> {
    const { indicatorTypes, useCache = true, forceRecompute = false } = options;
    const cacheKey = `indicators:${tokenAddress}:${chain}:${startTime.toISO()}:${endTime.toISO()}:${indicatorTypes?.join(',') || 'all'}`;

    if (useCache && !forceRecompute && this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as Map<number, IndicatorValue[]>;
      }
    }

    try {
      const indicators = await this.indicatorsRepo.getIndicators(
        tokenAddress,
        chain,
        startTime,
        endTime,
        indicatorTypes
      );

      if (useCache && this.config.enableCache) {
        this.setCache(cacheKey, indicators);
      }

      return indicators;
    } catch (error) {
      logger.error('Error retrieving indicators', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Token Metadata
  // ============================================================================

  /**
   * Store token metadata snapshot
   * CRITICAL: Preserves full mint address and exact case
   */
  async storeTokenMetadata(
    tokenAddress: string,
    chain: string,
    timestamp: number,
    metadata: TokenMetadata
  ): Promise<void> {
    try {
      await this.tokenMetadataRepo.upsertMetadata(tokenAddress, chain, timestamp, metadata);

      // Invalidate cache
      if (this.config.enableCache) {
        this.invalidateCache(`metadata:${tokenAddress}:${chain}`);
      }

      logger.debug('Stored token metadata', {
        token: tokenAddress.substring(0, 20) + '...',
        chain,
        timestamp,
      });
    } catch (error) {
      logger.error('Error storing token metadata', error as Error, {
        token: tokenAddress.substring(0, 20) + '...',
      });
      throw error;
    }
  }

  /**
   * Get latest token metadata
   * CRITICAL: Uses full mint address, case-preserved
   */
  async getLatestTokenMetadata(
    tokenAddress: string,
    chain: string,
    useCache: boolean = true
  ): Promise<TokenMetadata | null> {
    const cacheKey = `metadata:latest:${tokenAddress}:${chain}`;

    // Check cache first
    if (useCache && this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as TokenMetadata | null;
      }
    }

    try {
      const snapshot = await this.tokenMetadataRepo.getLatestMetadata(tokenAddress, chain);

      if (!snapshot) {
        return null;
      }

      // Convert snapshot to TokenMetadata
      const metadata: TokenMetadata = {
        name: snapshot.name,
        symbol: snapshot.symbol,
        decimals: snapshot.decimals,
        price: snapshot.price,
        marketCap: snapshot.marketCap,
        volume24h: snapshot.volume24h,
        priceChange24h: snapshot.priceChange24h,
        logoURI: snapshot.logoURI,
      };

      // Store in cache
      if (useCache && this.config.enableCache) {
        this.setCache(cacheKey, metadata);
      }

      return metadata;
    } catch (error) {
      logger.error('Error retrieving token metadata', error as Error, {
        token: tokenAddress.substring(0, 20) + '...',
      });
      throw error;
    }
  }

  /**
   * Get token metadata history
   * CRITICAL: Uses full mint address, case-preserved
   */
  async getTokenMetadataHistory(
    tokenAddress: string,
    chain: string,
    startTime: DateTime,
    endTime: DateTime
  ): Promise<Array<TokenMetadata & { timestamp: number }>> {
    try {
      const snapshots = await this.tokenMetadataRepo.getMetadataHistory(
        tokenAddress,
        chain,
        startTime,
        endTime
      );

      return snapshots.map((snapshot: TokenMetadataSnapshot) => ({
        name: snapshot.name,
        symbol: snapshot.symbol,
        decimals: snapshot.decimals,
        price: snapshot.price,
        marketCap: snapshot.marketCap,
        volume24h: snapshot.volume24h,
        priceChange24h: snapshot.priceChange24h,
        logoURI: snapshot.logoURI,
        timestamp: snapshot.timestamp,
      }));
    } catch (error) {
      logger.error('Error retrieving token metadata history', error as Error, {
        token: tokenAddress.substring(0, 20) + '...',
      });
      throw error;
    }
  }

  // ============================================================================
  // Simulation Results
  // ============================================================================

  /**
   * Store simulation run metadata
   * @deprecated PostgreSQL removed. Use DuckDB storage service directly.
   */
  async storeSimulationRun(_metadata: SimulationRunMetadata): Promise<number> {
    throw new Error('storeSimulationRun is not available. PostgreSQL has been removed. Use DuckDB storage service directly.');
  }

  /**
   * Store simulation results summary
   * @deprecated PostgreSQL removed. Use DuckDB storage service directly.
   */
  async storeSimulationResults(_simulationRunId: number, result: SimulationResult): Promise<void> {
    // Store events in ClickHouse only (PostgreSQL removed)
    if (result.events.length > 0) {
      throw new ValidationError('Event storage requires token address and chain', {
        operation: 'storeSimulationResults',
        eventsCount: result.events.length,
      });
    }
    logger.warn('storeSimulationResults: PostgreSQL removed. Only ClickHouse event storage available.');
  }

  /**
   * Store simulation events
   */
  async storeSimulationEvents(
    simulationRunId: number,
    tokenAddress: string,
    chain: string,
    events: SimulationEvent[]
  ): Promise<void> {
    if (events.length === 0) return;

    try {
      await this.simulationEventsRepo.insertEvents(simulationRunId, tokenAddress, chain, events);

      logger.debug('Stored simulation events', {
        simulationRunId,
        count: events.length,
      });
    } catch (error) {
      logger.error('Error storing simulation events', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  private setCache(key: string, data: unknown): void {
    if (!this.config.enableCache) return;

    // Enforce max cache size
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry (simple FIFO)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  private invalidateCache(pattern: string): void {
    if (!this.config.enableCache) return;

    // Simple pattern matching (starts with)
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  private cleanupCache(): void {
    if (!this.config.enableCache) return;

    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.config.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Cleanup resources (clear cache and intervals)
   */
  cleanup(): void {
    this.clearCache();
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = undefined;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxCacheSize,
    };
  }
}

/**
 * Default storage engine instance
 */
let defaultEngine: StorageEngine | null = null;

/**
 * Get or create the default storage engine instance
 */
export function getStorageEngine(config?: StorageEngineConfig): StorageEngine {
  if (!defaultEngine) {
    defaultEngine = new StorageEngine(config);
  }
  return defaultEngine;
}
