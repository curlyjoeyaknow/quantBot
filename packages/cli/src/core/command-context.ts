/**
 * Command Context - Lazy service creation and initialization
 *
 * This is NOT a framework - just an object that knows how to create services
 * and ensure storage is initialized. Removes service instantiation from command files.
 */

import {
  CallersRepository,
  OhlcvRepository,
  // PostgreSQL repositories removed - use DuckDB equivalents
  // CallsRepository, TokensRepository, AlertsRepository, SimulationRunsRepository
} from '@quantbot/storage';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import { TelegramAlertIngestionService } from '@quantbot/ingestion';
import { OhlcvFetchJob } from '@quantbot/jobs';
import { getAnalyticsEngine } from '@quantbot/analytics';
import type { AnalyticsEngine } from '@quantbot/analytics';
import { getPythonEngine, type PythonEngine } from '@quantbot/utils';
import { DuckDBStorageService, ClickHouseService, SimulationService } from '@quantbot/simulation';
import { TelegramPipelineService } from '@quantbot/ingestion';
import { AnalyticsService } from '@quantbot/analytics';
import { ensureInitialized } from './initialization-manager.js';

/**
 * Services available in command context
 */
export interface CommandServices {
  ohlcvIngestion(): OhlcvIngestionService;
  telegramIngestion(): TelegramAlertIngestionService;
  ohlcvFetchJob(): OhlcvFetchJob;
  ohlcvRepository(): OhlcvRepository;
  analyticsEngine(): AnalyticsEngine;
  pythonEngine(): PythonEngine;
  duckdbStorage(): DuckDBStorageService;
  clickHouse(): ClickHouseService;
  telegramPipeline(): TelegramPipelineService;
  simulation(): SimulationService;
  analytics(): AnalyticsService;
  // simulationRunsRepository(): SimulationRunsRepository; // PostgreSQL removed
  callersRepository(): CallersRepository; // DuckDB version
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
  analyticsEngineOverride?: AnalyticsEngine;
  /**
   * Override Python engine (for testing)
   */
  pythonEngineOverride?: PythonEngine;
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
   * Uses overrides from options if provided, otherwise creates default instances
   */
  private _createServices(): CommandServices {
    return {
      ohlcvIngestion: () => {
        // AlertsRepository removed - service updated to not require it
        return new OhlcvIngestionService();
      },
      ohlcvFetchJob: () => {
        return new OhlcvFetchJob();
      },
      telegramIngestion: () => {
        // PostgreSQL repositories removed - use ingestTelegramJson workflow instead
        throw new Error(
          'TelegramAlertIngestionService requires PostgreSQL repositories which were removed. Use ingestTelegramJson workflow instead.'
        );
      },
      ohlcvRepository: () => {
        return new OhlcvRepository();
      },
      analyticsEngine: () => {
        // Use override if provided (for tests/Python integration), otherwise use singleton
        return this._options.analyticsEngineOverride ?? getAnalyticsEngine();
      },
      pythonEngine: () => {
        // Use override if provided (for tests), otherwise use singleton
        return this._options.pythonEngineOverride ?? getPythonEngine();
      },
      duckdbStorage: () => {
        const engine = this._options.pythonEngineOverride ?? getPythonEngine();
        return new DuckDBStorageService(engine);
      },
      clickHouse: () => {
        const engine = this._options.pythonEngineOverride ?? getPythonEngine();
        return new ClickHouseService(engine);
      },
      telegramPipeline: () => {
        const engine = this._options.pythonEngineOverride ?? getPythonEngine();
        return new TelegramPipelineService(engine);
      },
      simulation: () => {
        const engine = this._options.pythonEngineOverride ?? getPythonEngine();
        return new SimulationService(engine);
      },
      analytics: () => {
        const engine = this._options.pythonEngineOverride ?? getPythonEngine();
        return new AnalyticsService(engine);
      },
      // simulationRunsRepository removed (PostgreSQL)
      callersRepository: () => {
        // Use DuckDB CallersRepository - requires dbPath
        const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';
        return new CallersRepository(dbPath);
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
