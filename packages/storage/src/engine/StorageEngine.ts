/**
 * Unified Storage Engine for QuantBot
 * 
 * Provides a single, robust interface for storing and retrieving:
 * - OHLCV candles (ClickHouse)
 * - Token calls (Postgres)
 * - Strategies (Postgres)
 * - Indicators (ClickHouse for computed values)
 * - Simulation results (Postgres + ClickHouse)
 * 
 * This engine abstracts the complexity of multi-database storage and provides
 * intelligent caching, query optimization, and data consistency guarantees.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type {
  Candle,
  Call,
  StrategyConfig,
  SimulationResult,
  SimulationEvent,
  Token,
  Caller,
  Alert,
  TokenMetadata,
} from '@quantbot/core';
import type { TokenMetadataSnapshot } from '../../clickhouse/repositories/TokenMetadataRepository';

// Import repositories
import { OhlcvRepository } from '../../clickhouse/repositories/OhlcvRepository';
import { SimulationEventsRepository } from '../../clickhouse/repositories/SimulationEventsRepository';
import { TokensRepository } from '../../postgres/repositories/TokensRepository';
import { CallsRepository } from '../../postgres/repositories/CallsRepository';
import { StrategiesRepository } from '../../postgres/repositories/StrategiesRepository';
import { AlertsRepository } from '../../postgres/repositories/AlertsRepository';
import { CallersRepository } from '../../postgres/repositories/CallersRepository';

// Import indicator storage
import { IndicatorsRepository } from '../../clickhouse/repositories/IndicatorsRepository';

// Import token metadata storage
import { TokenMetadataRepository } from '../../clickhouse/repositories/TokenMetadataRepository';

// Import simulation results storage
import { SimulationResultsRepository } from '../../postgres/repositories/SimulationResultsRepository';

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
  private readonly tokensRepo: TokensRepository;
  private readonly callsRepo: CallsRepository;
  private readonly strategiesRepo: StrategiesRepository;
  private readonly alertsRepo: AlertsRepository;
  private readonly callersRepo: CallersRepository;
  private readonly simulationResultsRepo: SimulationResultsRepository;

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
    this.tokensRepo = new TokensRepository();
    this.callsRepo = new CallsRepository();
    this.strategiesRepo = new StrategiesRepository();
    this.alertsRepo = new AlertsRepository();
    this.callersRepo = new CallersRepository();
    this.simulationResultsRepo = new SimulationResultsRepository();

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
      throw new Error(`Invalid interval: ${interval}. Must be one of: ${validIntervals.join(', ')}`);
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
      const candles = await this.ohlcvRepo.getCandles(
        tokenAddress,
        chain,
        interval,
        { from: startTime.toJSDate(), to: endTime.toJSDate() } as { from: Date; to: Date }
      );

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
   * CRITICAL: Preserves full mint address and exact case
   */
  async storeCallerAlert(
    tokenAddress: string,
    chain: string,
    callerId: number,
    alertTimestamp: DateTime,
    data: {
      alertPrice?: number;
      initialMcap?: number;
      initialPrice?: number; // Price at alert time (for performance calculations)
      confidence?: number;
      chatId?: string;
      messageId?: string;
      messageText?: string;
      rawPayload?: Record<string, unknown>;
    }
  ): Promise<number> {
    try {
      // Get or create token
      const token = await this.tokensRepo.getOrCreateToken(chain as any, tokenAddress);

      // Store alert with initial mcap and price
      const alertId = await this.alertsRepo.insertAlert({
        tokenId: token.id,
        callerId,
        side: 'buy',
        alertPrice: data.alertPrice,
        alertTimestamp: alertTimestamp.toJSDate(),
        initialMcap: data.initialMcap,
        initialPrice: data.initialPrice || data.alertPrice, // Use alertPrice as fallback
        confidence: data.confidence,
        chatId: data.chatId,
        messageId: data.messageId,
        messageText: data.messageText,
        rawPayload: data.rawPayload,
      });

      // Invalidate cache
      if (this.config.enableCache) {
        this.invalidateCache(`alerts:caller:${callerId}`);
        this.invalidateCache(`alerts:token:${token.id}`);
      }

      logger.info('Stored caller alert', {
        alertId,
        callerId,
        token: tokenAddress.substring(0, 20) + '...',
        initialMcap: data.initialMcap,
        initialPrice: data.initialPrice || data.alertPrice,
      });

      return alertId;
    } catch (error) {
      logger.error('Error storing caller alert', error as Error, {
        token: tokenAddress.substring(0, 20) + '...',
        callerId,
      });
      throw error;
    }
  }

  /**
   * Update caller alert metrics (time to ATH, max ROI)
   */
  async updateCallerAlertMetrics(
    alertId: number,
    metrics: {
      timeToATH?: number; // Seconds from alert to ATH
      maxROI?: number; // Maximum ROI percentage
      athPrice?: number; // All-time high price
      athTimestamp?: DateTime; // Timestamp of ATH
    }
  ): Promise<void> {
    try {
      await this.alertsRepo.updateAlertMetrics(alertId, {
        timeToATH: metrics.timeToATH,
        maxROI: metrics.maxROI,
        athPrice: metrics.athPrice,
        athTimestamp: metrics.athTimestamp?.toJSDate(),
      });

      // Invalidate cache
      if (this.config.enableCache) {
        this.invalidateCache(`alerts:${alertId}`);
      }

      logger.debug('Updated caller alert metrics', { alertId, metrics });
    } catch (error) {
      logger.error('Error updating caller alert metrics', error as Error, { alertId });
      throw error;
    }
  }

  /**
   * Get caller alerts with metrics
   */
  async getCallerAlerts(
    callerId: number,
    options?: { from?: DateTime; to?: DateTime; limit?: number }
  ): Promise<Array<Alert & { 
    initialMcap?: number; 
    initialPrice?: number;
    timeToATH?: number; 
    maxROI?: number; 
    athPrice?: number; 
    athTimestamp?: DateTime;
  }>> {
    const cacheKey = `alerts:caller:${callerId}:${options?.from?.toISO()}:${options?.to?.toISO()}`;

    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as any;
      }
    }

    try {
      const alerts = await this.alertsRepo.findByCaller(callerId, {
        from: options?.from?.toJSDate(),
        to: options?.to?.toJSDate(),
        limit: options?.limit,
      });

      if (this.config.enableCache) {
        this.setCache(cacheKey, alerts);
      }

      return alerts;
    } catch (error) {
      logger.error('Error retrieving caller alerts', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Token Calls
  // ============================================================================

  /**
   * Store a token call
   */
  async storeCall(call: Omit<Call, 'id' | 'createdAt'>): Promise<number> {
    try {
      const callId = await this.callsRepo.create({
        alertId: call.alertId,
        tokenId: call.tokenId,
        callerId: call.callerId,
        strategyId: call.strategyId,
        side: call.side,
        signalType: call.signalType,
        signalStrength: call.signalStrength,
        signalTimestamp: call.signalTimestamp,
        metadata: call.metadata,
      });

      // Invalidate cache
      if (this.config.enableCache) {
        this.invalidateCache(`calls:token:${call.tokenId}`);
        this.invalidateCache(`calls:caller:${call.callerId}`);
      }

      logger.debug('Stored call', { callId, tokenId: call.tokenId });
      return callId;
    } catch (error) {
      logger.error('Error storing call', error as Error);
      throw error;
    }
  }

  /**
   * Retrieve calls by token
   */
  async getCallsByToken(
    tokenId: number,
    options?: { from?: DateTime; to?: DateTime; limit?: number }
  ): Promise<Call[]> {
    const cacheKey = `calls:token:${tokenId}:${options?.from?.toISO()}:${options?.to?.toISO()}`;

    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as Call[];
      }
    }

    try {
      const calls = await this.callsRepo.findByToken(tokenId, options);
      if (this.config.enableCache) {
        this.setCache(cacheKey, calls);
      }
      return calls;
    } catch (error) {
      logger.error('Error retrieving calls', error as Error);
      throw error;
    }
  }

  /**
   * Retrieve calls by caller
   */
  async getCallsByCaller(
    callerId: number,
    options?: { from?: DateTime; to?: DateTime; limit?: number }
  ): Promise<Call[]> {
    const cacheKey = `calls:caller:${callerId}:${options?.from?.toISO()}:${options?.to?.toISO()}`;

    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as Call[];
      }
    }

    try {
      const calls = await this.callsRepo.findByCaller(callerId, options);
      if (this.config.enableCache) {
        this.setCache(cacheKey, calls);
      }
      return calls;
    } catch (error) {
      logger.error('Error retrieving calls', error as Error);
      throw error;
    }
  }

  // ============================================================================
  // Strategies
  // ============================================================================

  /**
   * Store a strategy
   */
  async storeStrategy(
    strategy: Omit<StrategyConfig, 'createdAt' | 'updatedAt'>
  ): Promise<number> {
    try {
      const strategyId = await this.strategiesRepo.create({
        name: strategy.name,
        version: strategy.version,
        category: strategy.category,
        description: strategy.description,
        config: strategy.config,
        isActive: strategy.isActive,
      });

      // Invalidate cache
      if (this.config.enableCache) {
        this.invalidateCache('strategies:all');
        this.invalidateCache(`strategies:${strategy.name}`);
      }

      logger.info('Stored strategy', { strategyId, name: strategy.name });
      return strategyId;
    } catch (error) {
      logger.error('Error storing strategy', error as Error);
      throw error;
    }
  }

  /**
   * Retrieve all active strategies
   */
  async getActiveStrategies(): Promise<StrategyConfig[]> {
    const cacheKey = 'strategies:active';

    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as StrategyConfig[];
      }
    }

    try {
      const strategies = await this.strategiesRepo.findAllActive();
      if (this.config.enableCache) {
        this.setCache(cacheKey, strategies);
      }
      return strategies;
    } catch (error) {
      logger.error('Error retrieving strategies', error as Error);
      throw error;
    }
  }

  /**
   * Retrieve strategy by name
   */
  async getStrategy(name: string, version?: string): Promise<StrategyConfig | null> {
    const cacheKey = `strategies:${name}:${version || '1'}`;

    if (this.config.enableCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.config.cacheTTL) {
        return cached.data as StrategyConfig | null;
      }
    }

    try {
      const strategy = await this.strategiesRepo.findByName(name, version);
      if (this.config.enableCache) {
        this.setCache(cacheKey, strategy);
      }
      return strategy;
    } catch (error) {
      logger.error('Error retrieving strategy', error as Error);
      throw error;
    }
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
      await this.indicatorsRepo.upsertIndicators(
        tokenAddress,
        chain,
        timestamp,
        indicators
      );

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
      await this.tokenMetadataRepo.upsertMetadata(
        tokenAddress,
        chain,
        timestamp,
        metadata
      );

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
      const snapshot = await this.tokenMetadataRepo.getLatestMetadata(
        tokenAddress,
        chain
      );

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
   */
  async storeSimulationRun(metadata: SimulationRunMetadata): Promise<number> {
    // This would need to be implemented in a repository
    // For now, we'll use the simulation results repository pattern
    throw new Error('Not yet implemented - requires SimulationRunsRepository');
  }

  /**
   * Store simulation results summary
   */
  async storeSimulationResults(
    simulationRunId: number,
    result: SimulationResult
  ): Promise<void> {
    try {
      // Store summary in Postgres
      await this.simulationResultsRepo.upsertSummary({
        simulationRunId,
        finalPnl: result.finalPnl,
        // Additional metrics would be calculated from result
        metadata: {
          entryPrice: result.entryPrice,
          finalPrice: result.finalPrice,
          totalCandles: result.totalCandles,
        },
      });

      // Store events in ClickHouse
      if (result.events.length > 0) {
        // This would need the simulation run metadata to get token info
        // For now, we'll assume it's passed separately
        throw new Error('Event storage requires token address and chain');
      }

      logger.info('Stored simulation results', { simulationRunId });
    } catch (error) {
      logger.error('Error storing simulation results', error as Error);
      throw error;
    }
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
      await this.simulationEventsRepo.insertEvents(
        simulationRunId,
        tokenAddress,
        chain,
        events
      );

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

