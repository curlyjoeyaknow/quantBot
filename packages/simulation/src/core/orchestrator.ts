/**
 * Simulation Orchestrator
 * =======================
 * High-level orchestration for running simulations across multiple targets.
 *
 * @deprecated This orchestrator has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/simulation/orchestrator instead.
 * This file is kept for backward compatibility only and will be removed in a future version.
 */

import { DateTime } from 'luxon';
import type {
  Candle,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
  StrategyLeg,
  SignalGroup,
  SimulationResult,
} from '../types';
import type { ExtendedSimulationResult } from '../types/results';
import type { PeriodMetricsConfig } from '../config';
// eslint-disable-next-line no-restricted-imports
import { fetchHybridCandlesWithMetadata } from '@quantbot/ohlcv';
import type { TokenMetadata } from '@quantbot/core';
import { simulateStrategy, type SimulationOptions } from './simulator';
import { getResultCache, type ResultCacheConfig } from '../storage/result-cache';
import { getPerformanceMonitor } from '../performance/monitor';
import { enrichSimulationResultWithPeriodMetrics } from '../period-metrics/period-metrics';

/**
 * Simulation target
 */
export interface SimulationTarget {
  /** Token mint address */
  mint: string;
  /** Chain identifier */
  chain: string;
  /** Simulation start time */
  startTime: DateTime;
  /** Simulation end time */
  endTime: DateTime;
  /** Alert time (for optimized candle fetching) */
  alertTime?: DateTime;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Scenario configuration
 */
export interface ScenarioConfig {
  /** Scenario ID */
  id?: string;
  /** Scenario name */
  name: string;
  /** Strategy legs */
  strategy: StrategyLeg[];
  /** Stop loss config */
  stopLoss?: StopLossConfig;
  /** Entry config */
  entry?: EntryConfig;
  /** Re-entry config */
  reEntry?: ReEntryConfig;
  /** Cost config */
  costs?: CostConfig;
  /** Entry signal */
  entrySignal?: SignalGroup;
  /** Exit signal */
  exitSignal?: SignalGroup;
  /** Period metrics config for re-entry analysis */
  periodMetrics?: PeriodMetricsConfig;
}

/**
 * Run context (single simulation result)
 */
export interface SimulationRunContext {
  scenario: ScenarioConfig;
  target: SimulationTarget;
  candles: Candle[];
  result: SimulationResult | ExtendedSimulationResult;
  metadata?: TokenMetadata;
}

/**
 * Run error
 */
export interface SimulationRunError {
  target: SimulationTarget;
  error: Error;
}

/**
 * Scenario run summary
 */
export interface ScenarioRunSummary {
  scenarioId?: string;
  scenarioName: string;
  totalTargets: number;
  successes: number;
  failures: number;
  results: SimulationRunContext[];
  errors: SimulationRunError[];
}

/**
 * Run options
 */
export interface RunOptions {
  /** Maximum concurrent simulations */
  maxConcurrency: number;
  /** Cache policy */
  cachePolicy: 'prefer-cache' | 'refresh' | 'cache-only';
  /** Dry run (don't persist results) */
  dryRun: boolean;
  /** Fail fast on first error */
  failFast: boolean;
  /** Progress callback interval */
  progressInterval: number;
}

/**
 * Default run options
 */
export const DEFAULT_RUN_OPTIONS: RunOptions = {
  maxConcurrency: 4,
  cachePolicy: 'prefer-cache',
  dryRun: false,
  failFast: true,
  progressInterval: 100,
};

/**
 * Result sink interface
 */
export interface SimulationResultSink {
  name: string;
  handle(context: SimulationRunContext): Promise<void>;
}

/**
 * Logger interface
 */
export interface SimulationLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Console logger implementation
 */
class ConsoleLogger implements SimulationLogger {
  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.SIMULATION_DEBUG === 'true') {
      console.debug(`[simulation:debug] ${message}`, meta ?? {});
    }
  }
  info(message: string, meta?: Record<string, unknown>) {
    console.info(`[simulation] ${message}`, meta ?? {});
  }
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(`[simulation:warn] ${message}`, meta ?? {});
  }
  error(message: string, meta?: Record<string, unknown>) {
    console.error(`[simulation:error] ${message}`, meta ?? {});
  }
}

/**
 * Orchestrator dependencies
 */
export interface OrchestratorDeps {
  sinks?: SimulationResultSink[];
  logger?: SimulationLogger;
  cacheConfig?: ResultCacheConfig;
}

/**
 * Scenario run request
 */
export interface ScenarioRunRequest {
  scenario: ScenarioConfig;
  targets: SimulationTarget[];
  runOptions?: Partial<RunOptions>;
}

/**
 * Simulation Orchestrator
 *
 * Note: This orchestrator will be moved to @quantbot/workflows in Phase 3.
 * For now, it fetches candles from @quantbot/ohlcv directly.
 */
export class SimulationOrchestrator {
  private readonly sinks: SimulationResultSink[];
  private readonly logger: SimulationLogger;
  private readonly resultCache: ReturnType<typeof getResultCache>;

  constructor(deps: OrchestratorDeps = {}) {
    this.sinks = deps.sinks ?? [];
    this.logger = deps.logger ?? new ConsoleLogger();
    this.resultCache = getResultCache(deps.cacheConfig);
  }

  /**
   * Run a scenario on multiple targets
   */
  async runScenario(request: ScenarioRunRequest): Promise<ScenarioRunSummary> {
    const runOptions: RunOptions = {
      ...DEFAULT_RUN_OPTIONS,
      ...request.runOptions,
    };

    const results: SimulationRunContext[] = [];
    const errors: SimulationRunError[] = [];
    const { scenario, targets } = request;

    // Process in batches with concurrency limit
    const concurrency = runOptions.maxConcurrency || 4;

    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);

      const batchPromises = batch.map(async (target) => {
        try {
          const perfMonitor = getPerformanceMonitor();
          const context = await perfMonitor.measure(
            'runSimulation',
            () => this.runSingleSimulation(scenario, target),
            { mint: target.mint.substring(0, 20) + '...', chain: target.chain }
          );

          // Run sinks
          await Promise.all(this.sinks.map((sink) => sink.handle(context)));

          return { success: true, context };
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.warn('Simulation target failed', {
            scenario: scenario.name,
            mint: target.mint,
            chain: target.chain,
            error: err.message,
          });

          if (runOptions.failFast) {
            throw error;
          }

          return { success: false, error: { target, error: err } };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      for (const batchResult of batchResults) {
        if (batchResult && batchResult.success && batchResult.context) {
          results.push(batchResult.context);
        } else if (batchResult && !batchResult.success && batchResult.error) {
          errors.push(batchResult.error);
        }
      }

      // Progress logging
      if (runOptions.progressInterval > 0 && results.length % runOptions.progressInterval === 0) {
        this.logger.info('Simulation progress', {
          scenario: scenario.name,
          completed: results.length,
          total: targets.length,
        });
      }
    }

    // Log performance summary if enabled
    const perfMonitor = getPerformanceMonitor();
    perfMonitor.logSummary();

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      totalTargets: targets.length,
      successes: results.length,
      failures: errors.length,
      results,
      errors,
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.resultCache.getStats();
  }

  /**
   * Clear result cache
   */
  clearCache(): void {
    this.resultCache.clear();
  }

  /**
   * Run a single simulation
   */
  private async runSingleSimulation(
    scenario: ScenarioConfig,
    target: SimulationTarget
  ): Promise<SimulationRunContext> {
    // Fetch candles from OHLCV package (external to simulation)
    const fetchResult = await fetchHybridCandlesWithMetadata(
      target.mint,
      target.startTime,
      target.endTime,
      target.chain,
      target.alertTime ?? target.startTime
    );

    const candles = fetchResult.candles;
    const metadata: TokenMetadata | undefined = fetchResult.metadata ?? undefined;

    if (!candles.length) {
      throw new Error('No candle data available for target');
    }

    // Check cache first
    const cacheKey = this.resultCache.generateCacheKey(
      scenario,
      target.mint,
      candles[0].timestamp,
      candles[candles.length - 1].timestamp,
      candles.length
    );

    let result = this.resultCache.get(cacheKey);
    if (result) {
      this.logger.debug('Using cached simulation result', {
        mint: target.mint.substring(0, 20) + '...',
        chain: target.chain,
      });
    } else {
      // Run simulation
      const options: SimulationOptions = {
        entrySignal: scenario.entrySignal,
        exitSignal: scenario.exitSignal,
      };

      result = await simulateStrategy(
        candles,
        scenario.strategy,
        scenario.stopLoss,
        scenario.entry,
        scenario.reEntry,
        scenario.costs,
        options
      );

      // Cache result
      this.resultCache.set(cacheKey, result);
    }

    // Calculate period metrics if enabled
    let extendedResult: SimulationResult | ExtendedSimulationResult = result;
    if (scenario.periodMetrics?.enabled) {
      const periodMetrics = enrichSimulationResultWithPeriodMetrics(
        result,
        candles,
        scenario.periodMetrics
      );

      if (periodMetrics) {
        extendedResult = {
          ...result,
          periodMetrics,
        } as ExtendedSimulationResult;
      }
    }

    return {
      scenario,
      target,
      candles,
      result: extendedResult,
      metadata: metadata ?? undefined,
    };
  }

  /**
   * Add a result sink
   */
  addSink(sink: SimulationResultSink): void {
    this.sinks.push(sink);
  }

  /**
   * Remove a result sink
   */
  removeSink(sinkName: string): void {
    const index = this.sinks.findIndex((s) => s.name === sinkName);
    if (index !== -1) {
      this.sinks.splice(index, 1);
    }
  }
}

/**
 * Create a new orchestrator
 */
export function createOrchestrator(deps?: OrchestratorDeps): SimulationOrchestrator {
  return new SimulationOrchestrator(deps);
}
