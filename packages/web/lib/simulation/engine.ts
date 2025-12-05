import { DateTime } from 'luxon';
import { Candle, fetchHybridCandles } from './candles';
import {
  CostConfig,
  EntryConfig,
  OutputTargetConfig,
  RunOptions,
  SimulationScenarioConfig,
  StopLossConfig,
  ReEntryConfig,
  StrategyLeg,
} from './config';

export type Strategy = StrategyLeg;

// Re-export config types for convenience
export type { StopLossConfig, EntryConfig, ReEntryConfig } from './config';

export type SimulationEvent = {
  type:
    | 'entry'
    | 'stop_moved'
    | 'target_hit'
    | 'stop_loss'
    | 'final_exit'
    | 'trailing_entry_triggered'
    | 're_entry';
  timestamp: number;
  price: number;
  description: string;
  remainingPosition: number;
  pnlSoFar: number;
};

export type SimulationResult = {
  finalPnl: number;
  events: SimulationEvent[];
  entryPrice: number;
  finalPrice: number;
  totalCandles: number;
  entryOptimization: {
    lowestPrice: number;
    lowestPriceTimestamp: number;
    lowestPricePercent: number;
    lowestPriceTimeFromEntry: number;
    trailingEntryUsed: boolean;
    actualEntryPrice: number;
    entryDelay: number;
  };
};

export interface SimulationTarget {
  mint: string;
  chain: string;
  startTime: DateTime;
  endTime: DateTime;
  metadata?: Record<string, unknown>;
}

export interface SimulationRunContext {
  scenario: SimulationScenarioConfig;
  target: SimulationTarget;
  candles: Candle[];
  result: SimulationResult;
}

export interface SimulationRunError {
  target: SimulationTarget;
  error: Error;
}

export interface ScenarioRunSummary {
  scenarioId?: string;
  scenarioName: string;
  totalTargets: number;
  successes: number;
  failures: number;
  results: SimulationRunContext[];
  errors: SimulationRunError[];
}

export interface CandleDataProvider {
  fetchCandles(target: SimulationTarget): Promise<Candle[]>;
}

class HybridCandleProvider implements CandleDataProvider {
  async fetchCandles(target: SimulationTarget): Promise<Candle[]> {
    // Use startTime as alertTime for precise entry pricing
    return fetchHybridCandles(
      target.mint,
      target.startTime,
      target.endTime,
      target.chain,
      target.startTime, // Pass startTime as alertTime for 1m candles
    );
  }
}

export interface SimulationResultSink {
  name: string;
  handle(context: SimulationRunContext): Promise<void>;
}

export interface SimulationLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

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

export interface SimulationEngineDeps {
  dataProvider?: CandleDataProvider;
  sinks?: SimulationResultSink[];
  logger?: SimulationLogger;
  defaults?: Partial<ScenarioDefaults>;
}

export interface ScenarioDefaults {
  stopLoss: StopLossConfig;
  entry: EntryConfig;
  reEntry: ReEntryConfig;
  costs: CostConfig;
  outputs?: OutputTargetConfig[];
}

const DEFAULT_STOP_LOSS: StopLossConfig = { initial: -0.5, trailing: 0.5 };
const DEFAULT_ENTRY: EntryConfig = {
  initialEntry: 'none',
  trailingEntry: 'none',
  maxWaitTime: 60,
};
const DEFAULT_REENTRY: ReEntryConfig = {
  trailingReEntry: 'none',
  maxReEntries: 0,
  sizePercent: 0.5,
};
const DEFAULT_COSTS: CostConfig = {
  entrySlippageBps: 0,
  exitSlippageBps: 0,
  takerFeeBps: 25,
  borrowAprBps: 0,
};

const DEFAULT_RUN_OPTIONS: RunOptions = {
  maxConcurrency: 4,
  cachePolicy: 'prefer-cache',
  dryRun: false,
  failFast: true,
  progressInterval: 100,
};

export interface ScenarioRunRequest {
  scenario: SimulationScenarioConfig;
  targets: SimulationTarget[];
  runOptions?: Partial<RunOptions>;
  overrides?: Partial<ScenarioDefaults>;
}

export class SimulationEngine {
  private readonly dataProvider: CandleDataProvider;
  private readonly sinks: SimulationResultSink[];
  private readonly logger: SimulationLogger;
  private readonly defaults: ScenarioDefaults;

  constructor(deps: SimulationEngineDeps = {}) {
    this.dataProvider = deps.dataProvider ?? new HybridCandleProvider();
    this.sinks = deps.sinks ?? [];
    this.logger = deps.logger ?? new ConsoleLogger();
    this.defaults = {
      stopLoss: deps.defaults?.stopLoss ?? DEFAULT_STOP_LOSS,
      entry: deps.defaults?.entry ?? DEFAULT_ENTRY,
      reEntry: deps.defaults?.reEntry ?? DEFAULT_REENTRY,
      costs: deps.defaults?.costs ?? DEFAULT_COSTS,
      outputs: deps.defaults?.outputs,
    };
  }

  async runScenario(request: ScenarioRunRequest): Promise<ScenarioRunSummary> {
    const runOptions: RunOptions = {
      ...DEFAULT_RUN_OPTIONS,
      ...request.runOptions,
    };

    const results: SimulationRunContext[] = [];
    const errors: SimulationRunError[] = [];

    for (const target of request.targets) {
      try {
        const candles = await this.dataProvider.fetchCandles(target);
        if (!candles.length) {
          throw new Error('No candle data available for target');
        }

        const mergedConfigs = this.mergeScenarioConfigs(
          request.scenario,
          request.overrides,
        );

        const result = simulateStrategy(
          candles,
          request.scenario.strategy,
          mergedConfigs.stopLoss,
          mergedConfigs.entry,
          mergedConfigs.reEntry,
          mergedConfigs.costs,
        );

        const context: SimulationRunContext = {
          scenario: request.scenario,
          target,
          candles,
          result,
        };

        results.push(context);
        await Promise.all(this.sinks.map((sink) => sink.handle(context)));

        if (
          runOptions.progressInterval > 0 &&
          results.length % runOptions.progressInterval === 0
        ) {
          this.logger.info('Simulation progress', {
            scenario: request.scenario.name,
            completed: results.length,
            total: request.targets.length,
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ target, error: err });
        this.logger.warn('Simulation target failed', {
          scenario: request.scenario.name,
          mint: target.mint,
          chain: target.chain,
          error: err.message,
        });

        if (runOptions.failFast) {
          break;
        }
      }
    }

    return {
      scenarioId: request.scenario.id,
      scenarioName: request.scenario.name,
      totalTargets: request.targets.length,
      successes: results.length,
      failures: errors.length,
      results,
      errors,
    };
  }

  private mergeScenarioConfigs(
    scenario: SimulationScenarioConfig,
    overrides?: Partial<ScenarioDefaults>,
  ): ScenarioDefaults {
    return {
      stopLoss:
        scenario.stopLoss ??
        overrides?.stopLoss ??
        this.defaults.stopLoss ??
        DEFAULT_STOP_LOSS,
      entry:
        scenario.entry ??
        overrides?.entry ??
        this.defaults.entry ??
        DEFAULT_ENTRY,
      reEntry:
        scenario.reEntry ??
        overrides?.reEntry ??
        this.defaults.reEntry ??
        DEFAULT_REENTRY,
      costs:
        scenario.costs ??
        overrides?.costs ??
        this.defaults.costs ??
        DEFAULT_COSTS,
      outputs: scenario.outputs ?? overrides?.outputs ?? this.defaults.outputs,
    };
  }
}

export function simulateStrategy(
  candles: Candle[],
  strategy: Strategy[],
  stopLossConfig?: StopLossConfig,
  entryConfig?: EntryConfig,
  reEntryConfig?: ReEntryConfig,
  costConfig?: CostConfig,
): SimulationResult {
  if (!candles.length) {
    return {
      finalPnl: 0,
      events: [],
      entryPrice: 0,
      finalPrice: 0,
      totalCandles: 0,
      entryOptimization: {
        lowestPrice: 0,
        lowestPriceTimestamp: 0,
        lowestPricePercent: 0,
        lowestPriceTimeFromEntry: 0,
        trailingEntryUsed: false,
        actualEntryPrice: 0,
        entryDelay: 0,
      },
    };
  }

  const entryCfg: EntryConfig = entryConfig
    ? { ...DEFAULT_ENTRY, ...entryConfig }
    : { ...DEFAULT_ENTRY };
  const stopCfg: StopLossConfig = stopLossConfig
    ? { ...DEFAULT_STOP_LOSS, ...stopLossConfig }
    : { ...DEFAULT_STOP_LOSS };
  const reEntryCfg: ReEntryConfig = reEntryConfig
    ? { ...DEFAULT_REENTRY, ...reEntryConfig }
    : { ...DEFAULT_REENTRY };
  const costs: CostConfig = costConfig
    ? { ...DEFAULT_COSTS, ...costConfig }
    : { ...DEFAULT_COSTS };

  const entryCostMultiplier =
    1 + (costs.entrySlippageBps + costs.takerFeeBps) / 10_000;
  const exitCostMultiplier = Math.max(
    0,
    1 - (costs.exitSlippageBps + costs.takerFeeBps) / 10_000,
  );

  const initialPrice = candles[0].open;
  const finalPrice = candles[candles.length - 1].close;

  let lowestPrice = initialPrice;
  let lowestPriceTimestamp = candles[0].timestamp;
  let lowestPriceTimeFromEntry = 0;
  let actualEntryPrice = initialPrice;
  let entryDelay = 0;
  let trailingEntryUsed = false;
  let hasEntered = entryCfg.initialEntry === 'none';
  let initialEntryTriggered = false;

  const events: SimulationEvent[] = [];

  if (entryCfg.initialEntry !== 'none') {
    const dropPercent = entryCfg.initialEntry as number;
    const triggerPrice = initialPrice * (1 + dropPercent);
    
    for (const candle of candles) {
      if (candle.low <= triggerPrice) {
        actualEntryPrice = triggerPrice;
        entryDelay = (candle.timestamp - candles[0].timestamp) / 60;
        initialEntryTriggered = true;
        hasEntered = true;
        events.push({
          type: 'entry',
          timestamp: candle.timestamp,
          price: actualEntryPrice,
          description: `Initial entry at $${actualEntryPrice.toFixed(
            8,
          )} (${(Math.abs(dropPercent) * 100).toFixed(0)}% drop)`,
          remainingPosition: 1,
          pnlSoFar: 0,
        });
        break;
      }
    }
    
    if (!initialEntryTriggered) {
      events.push({
        type: 'entry',
        timestamp: candles[0].timestamp,
        price: initialPrice,
        description: `No trade: price never dropped ${(
          Math.abs(dropPercent) * 100
        ).toFixed(0)}%`,
        remainingPosition: 0,
        pnlSoFar: 0,
      });
      return { 
        finalPnl: 0, 
        events,
        entryPrice: initialPrice,
        finalPrice,
        totalCandles: candles.length, 
        entryOptimization: {
          lowestPrice,
          lowestPriceTimestamp,
          lowestPricePercent: 0,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 0,
          entryDelay: 0,
        },
      };
    }
  }

  if (!hasEntered && entryCfg.trailingEntry !== 'none') {
    const trailingPercent = entryCfg.trailingEntry as number;
    const maxWaitTimestamp = candles[0].timestamp + entryCfg.maxWaitTime * 60;

    for (const candle of candles) {
      if (candle.timestamp > maxWaitTimestamp) break;
      if (candle.low < lowestPrice) {
        lowestPrice = candle.low;
        lowestPriceTimestamp = candle.timestamp;
      }
    }

    const trailingTrigger = lowestPrice * (1 + trailingPercent);

    for (const candle of candles) {
      if (candle.timestamp > maxWaitTimestamp) break;
      if (candle.high >= trailingTrigger) {
        actualEntryPrice = trailingTrigger;
        entryDelay = (candle.timestamp - candles[0].timestamp) / 60;
        trailingEntryUsed = true;
        hasEntered = true;
        events.push({
          type: 'trailing_entry_triggered',
          timestamp: candle.timestamp,
          price: actualEntryPrice,
          description: `Trailing entry at $${actualEntryPrice.toFixed(
            8,
          )} (${(trailingPercent * 100).toFixed(1)}% from low)`,
          remainingPosition: 1,
          pnlSoFar: 0,
        });
        break;
      }
    }

    if (!hasEntered) {
      const fallback =
        candles.find((c) => c.timestamp <= maxWaitTimestamp) ??
        candles[candles.length - 1];
      actualEntryPrice = fallback.close;
      entryDelay = (fallback.timestamp - candles[0].timestamp) / 60;
    }
  }

  lowestPriceTimeFromEntry =
    (lowestPriceTimestamp - candles[0].timestamp) / 60;

  if (!trailingEntryUsed && events.length === 0) {
    events.push({
      type: 'entry',
      timestamp: candles[0].timestamp,
      price: actualEntryPrice,
      description: `Entry at $${actualEntryPrice.toFixed(8)}`,
      remainingPosition: 1,
      pnlSoFar: 0,
    });
  }

  const entryPriceForPnl = actualEntryPrice * entryCostMultiplier;
  let stopLoss = actualEntryPrice * (1 + stopCfg.initial);
  let stopMovedToEntry = false;
  const hasTrailing = stopCfg.trailing !== 'none';

  let pnl = 0;
  let remaining = 1;
  let targetIndex = 0;

  let reEntryCount = 0;
  let currentPeakPrice = actualEntryPrice;
  let waitingForReEntry = false;
  let reEntryTriggerPrice = 0;

  for (const candle of candles) {
    if (candle.low < lowestPrice) {
      lowestPrice = candle.low;
      lowestPriceTimestamp = candle.timestamp;
      lowestPriceTimeFromEntry = (candle.timestamp - candles[0].timestamp) / 60;
    }
    
    if (candle.high > currentPeakPrice) {
      currentPeakPrice = candle.high;
    }

    if (hasTrailing && !stopMovedToEntry) {
      const trailingTrigger = actualEntryPrice * (1 + (stopCfg.trailing as number));
      if (candle.high >= trailingTrigger) {
        stopLoss = actualEntryPrice;
        stopMovedToEntry = true;
        events.push({
          type: 'stop_moved',
          timestamp: candle.timestamp,
          price: candle.high,
          description: `Trailing stop at $${candle.high.toFixed(8)} (${(
            (stopCfg.trailing as number) * 100
          ).toFixed(0)}% gain)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
      }
    }

    if (waitingForReEntry && candle.low <= reEntryTriggerPrice) {
      const reEntryPrice = reEntryTriggerPrice;
      remaining = Math.min(1, remaining + reEntryCfg.sizePercent);
      reEntryCount++;
      waitingForReEntry = false;
      stopLoss = reEntryPrice * (1 + stopCfg.initial);
      stopMovedToEntry = false;
      currentPeakPrice = reEntryPrice;
      
      events.push({
        type: 're_entry',
        timestamp: candle.timestamp,
        price: reEntryPrice,
        description: `Re-entry at $${reEntryPrice.toFixed(8)} (${(
          (reEntryCfg.trailingReEntry as number) * 100
        ).toFixed(0)}% retrace)`,
        remainingPosition: remaining,
        pnlSoFar: pnl,
      });
      continue;
    }
    
    if (remaining > 0 && candle.low <= stopLoss) {
      const stopComponent =
        (stopLoss * exitCostMultiplier) / entryPriceForPnl;
      const stopPnl = remaining * stopComponent;
      pnl += stopPnl;
      events.push({
        type: 'stop_loss',
        timestamp: candle.timestamp,
        price: stopLoss,
        description: `Stop loss at $${stopLoss.toFixed(8)} (${(
          (stopLoss / actualEntryPrice - 1) *
          100
        ).toFixed(1)}%)`,
        remainingPosition: 0,
        pnlSoFar: pnl,
      });
      remaining = 0;

      if (
        reEntryCfg.trailingReEntry !== 'none' &&
        reEntryCount < reEntryCfg.maxReEntries
      ) {
        const retracePercent = reEntryCfg.trailingReEntry as number;
        reEntryTriggerPrice = actualEntryPrice * (1 - retracePercent);
        waitingForReEntry = true;
      } else {
        break;
      }
    }

    if (remaining > 0 && targetIndex < strategy.length) {
      const { percent, target } = strategy[targetIndex];
      const targetPrice = actualEntryPrice * target;
      if (candle.high >= targetPrice) {
        const realizedPrice = targetPrice * exitCostMultiplier;
        const targetPnl = percent * (realizedPrice / entryPriceForPnl);
        pnl += targetPnl;
        remaining = Math.max(0, remaining - percent);
        events.push({
          type: 'target_hit',
          timestamp: candle.timestamp,
          price: targetPrice,
          description: `Target ${target}x hit (sold ${(percent * 100).toFixed(
            0,
          )}%)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
        targetIndex++;

        if (
          reEntryCfg.trailingReEntry !== 'none' &&
          reEntryCount < reEntryCfg.maxReEntries
        ) {
          const retracePercent = reEntryCfg.trailingReEntry as number;
          reEntryTriggerPrice = targetPrice * (1 - retracePercent);
          waitingForReEntry = true;
        }
      }
    }
  }

  if (remaining > 0) {
    const exitComponent =
      (finalPrice * exitCostMultiplier) / entryPriceForPnl;
    const finalComponent = remaining * exitComponent;
    pnl += finalComponent;
    events.push({
      type: 'final_exit',
      timestamp: candles[candles.length - 1].timestamp,
      price: finalPrice,
      description: `Final exit ${(remaining * 100).toFixed(0)}% at $${finalPrice.toFixed(
        8,
      )}`,
      remainingPosition: 0,
      pnlSoFar: pnl,
    });
  }

  return {
    finalPnl: pnl,
    events,
    entryPrice: actualEntryPrice,
    finalPrice,
    totalCandles: candles.length,
    entryOptimization: {
      lowestPrice,
      lowestPriceTimestamp,
      lowestPricePercent: (lowestPrice / actualEntryPrice - 1) * 100,
      lowestPriceTimeFromEntry,
      trailingEntryUsed,
      actualEntryPrice,
      entryDelay,
    },
  };
}
