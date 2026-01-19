/**
 * Command Context - Lazy service creation and initialization
 *
 * This is NOT a framework - just an object that knows how to create services
 * and ensure storage is initialized. Removes service instantiation from command files.
 */

import {
  CallersRepository,
  OhlcvRepository,
  StrategiesRepository,
  ExperimentDuckDBAdapter,
  RunRepository,
  // New: Deduplication and audit services
  IngestionRunRepository,
  OhlcvDedupService,
  // PostgreSQL repositories removed - use DuckDB equivalents
  // CallsRepository, TokensRepository, AlertsRepository, SimulationRunsRepository
} from '@quantbot/storage';
import type { ExperimentRepository } from '@quantbot/core';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import { MarketDataIngestionService } from '@quantbot/jobs';
// TelegramAlertIngestionService temporarily commented out - needs repository refactoring
// import { TelegramAlertIngestionService } from '@quantbot/data/ingestion';
// import { OhlcvFetchJob } from '@quantbot/data/jobs';
import { AnalyticsEngine } from '@quantbot/analytics';
import type { AnalyticsEngine as AnalyticsEngineType } from '@quantbot/analytics';
import { PythonEngine, type PythonEngine as PythonEngineType } from '@quantbot/infra/utils';
import { StorageEngine } from '@quantbot/infra/storage';
// Import directly from source to avoid Vitest SSR module resolution issues
import { DuckDBStorageService } from '../../../simulation/src/duckdb-storage-service.js';
import { ClickHouseService } from '../../../simulation/src/clickhouse-service.js';
import { SimulationService } from '../../../simulation/src/simulation-service.js';
import { BacktestBaselineService } from '../../../simulation/src/backtest-baseline-service.js';
import { V1BaselinePythonService } from '../../../simulation/src/backtest/services/v1-baseline-python-service.js';
import { TelegramPipelineService } from '@quantbot/ingestion';
import { AnalyticsService } from '@quantbot/analytics';
import { getClickHouseClient } from '@quantbot/infra/storage';
import type { ClickHouseClient } from '@clickhouse/client';
import { ensureInitialized } from './initialization-manager.js';

/**
 * Services available in command context
 */
export interface CommandServices {
  ohlcvIngestion(): OhlcvIngestionService;
  marketDataIngestion(): MarketDataIngestionService;
  // telegramIngestion(): TelegramAlertIngestionService; // Temporarily disabled - needs repository refactoring
  // ohlcvFetchJob(): OhlcvFetchJob; // Temporarily disabled - jobs package not fully resolved
  ohlcvRepository(): OhlcvRepository;
  ohlcvDedup(): OhlcvDedupService;
  ingestionRunRepository(): IngestionRunRepository;
  analyticsEngine(): AnalyticsEngineType;
  pythonEngine(): PythonEngineType;
  storageEngine(): StorageEngine;
  duckdbStorage(): DuckDBStorageService;
  clickHouse(): ClickHouseService;
  clickHouseClient(): ClickHouseClient; // Low-level client (singleton for connection pooling)
  telegramPipeline(): TelegramPipelineService;
  simulation(): SimulationService;
  analytics(): AnalyticsService;
  backtestBaseline(): BacktestBaselineService; // Baseline alert backtest
  v1BaselinePython(): V1BaselinePythonService; // V1 baseline optimizer (Python)
  // simulationRunsRepository(): SimulationRunsRepository; // PostgreSQL removed
  callersRepository(): CallersRepository; // DuckDB version
  strategiesRepository(): StrategiesRepository; // DuckDB version
  experimentRepository(): ExperimentRepository; // Experiment tracking
  runRepository(): RunRepository; // ClickHouse run ledger
  // Add more services as needed
}

/**
 * Options for creating a CommandContext with service overrides
 * Useful for testing and future Python integration
 */
export interface CommandContextOptions {
  /**
   * Override analytics engine (for testing or Python integration)
   */
  analyticsEngineOverride?: AnalyticsEngineType;
  /**
   * Override Python engine (for testing)
   */
  pythonEngineOverride?: PythonEngineType;
  /**
   * Override storage engine (for testing)
   */
  storageEngineOverride?: StorageEngine;
  // Add more overrides as needed
}

/**
 * Command context - provides services and initialization
 */
export class CommandContext {
  private _initialized = false;
  private _services: CommandServices | null = null;
  private readonly _options: CommandContextOptions;

  constructor(options: CommandContextOptions = {}) {
    this._options = options;
  }

  /**
   * Ensure storage is initialized (lazy, only when needed)
   */
  async ensureInitialized(): Promise<void> {
    if (!this._initialized) {
      await ensureInitialized();
      this._initialized = true;
    }
  }

  /**
   * Get services (lazy creation)
   */
  get services(): CommandServices {
    if (!this._services) {
      this._services = this._createServices();
    }
    return this._services;
  }

  /**
   * Create service instances
   * Uses overrides from options if provided, otherwise creates new instances
   * NO SINGLETONS - all services created fresh through this factory
   */
  private _createServices(): CommandServices {
    // Create shared services once (lazy, but not singletons - created per CommandContext instance)
    const pythonEngine = this._options.pythonEngineOverride ?? new PythonEngine();
    const storageEngine = this._options.storageEngineOverride ?? new StorageEngine();
    const analyticsEngine = this._options.analyticsEngineOverride ?? new AnalyticsEngine();

    return {
      ohlcvIngestion: () => {
        // AlertsRepository removed - service updated to not require it
        return new OhlcvIngestionService();
      },
      marketDataIngestion: () => {
        return new MarketDataIngestionService();
      },
      // ohlcvFetchJob: () => {
      //   // Deprecated: Use OhlcvBirdeyeFetch directly or via workflow
      //   // Keeping for backward compatibility
      //   // Removed: require() - use ESM import if needed
      //   // const { OhlcvFetchJob } = await import('@quantbot/jobs');
      //   // return new OhlcvFetchJob();
      // },
      // telegramIngestion: () => {
      //   // PostgreSQL repositories removed - use ingestTelegramJson workflow instead
      //   throw new Error(
      //     'TelegramAlertIngestionService requires PostgreSQL repositories which were removed. Use ingestTelegramJson workflow instead.'
      //   );
      // },
      ohlcvRepository: () => {
        return new OhlcvRepository();
      },
      ohlcvDedup: () => {
        return new OhlcvDedupService();
      },
      ingestionRunRepository: () => {
        return new IngestionRunRepository();
      },
      analyticsEngine: () => {
        return analyticsEngine;
      },
      pythonEngine: () => {
        return pythonEngine;
      },
      storageEngine: () => {
        return storageEngine;
      },
      duckdbStorage: () => {
        return new DuckDBStorageService(pythonEngine);
      },
      clickHouse: () => {
        return new ClickHouseService(pythonEngine);
      },
      clickHouseClient: () => {
        // Low-level client - singleton for connection pooling
        // This is the ONLY place where getClickHouseClient() should be called
        return getClickHouseClient();
      },
      telegramPipeline: () => {
        return new TelegramPipelineService(pythonEngine);
      },
      simulation: () => {
        return new SimulationService(pythonEngine);
      },
      analytics: () => {
        return new AnalyticsService(pythonEngine);
      },
      backtestBaseline: () => {
        return new BacktestBaselineService(pythonEngine);
      },
      v1BaselinePython: () => {
        return new V1BaselinePythonService(pythonEngine);
      },
      // simulationRunsRepository removed (PostgreSQL)
      callersRepository: () => {
        // Use DuckDB CallersRepository - requires dbPath
        const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
        return new CallersRepository(dbPath);
      },
      strategiesRepository: () => {
        // Use DuckDB StrategiesRepository - requires dbPath
        const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
        return new StrategiesRepository(dbPath);
      },
      experimentRepository: () => {
        // Use DuckDB ExperimentRepository - requires dbPath
        const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
        return new ExperimentDuckDBAdapter(dbPath);
      },
      runRepository: () => {
        // ClickHouse RunRepository (singleton pattern via getClickHouseClient)
        return new RunRepository();
      },
    };
  }
}

/**
 * Factory function to create CommandContext with optional overrides
 * Useful for testing and future Python integration
 */
export function createCommandContext(options: CommandContextOptions = {}): CommandContext {
  return new CommandContext(options);
}
