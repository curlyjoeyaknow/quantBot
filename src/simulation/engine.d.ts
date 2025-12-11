import { DateTime } from 'luxon';
import { Candle } from './candles';
import { CostConfig, EntryConfig, OutputTargetConfig, RunOptions, SimulationScenarioConfig, StopLossConfig, ReEntryConfig, StrategyLeg, LadderConfig, SignalGroup } from './config';
export type Strategy = StrategyLeg;
export type { StopLossConfig, EntryConfig, ReEntryConfig } from './config';
export type SimulationEvent = {
    type: 'entry' | 'stop_moved' | 'target_hit' | 'stop_loss' | 'final_exit' | 'trailing_entry_triggered' | 're_entry' | 'ladder_entry' | 'ladder_exit';
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
export interface ScenarioRunRequest {
    scenario: SimulationScenarioConfig;
    targets: SimulationTarget[];
    runOptions?: Partial<RunOptions>;
    overrides?: Partial<ScenarioDefaults>;
}
export declare class SimulationEngine {
    private readonly dataProvider;
    private readonly sinks;
    private readonly logger;
    private readonly defaults;
    constructor(deps?: SimulationEngineDeps);
    runScenario(request: ScenarioRunRequest): Promise<ScenarioRunSummary>;
    private mergeScenarioConfigs;
}
export interface SimulationStrategyOptions {
    entrySignal?: SignalGroup;
    exitSignal?: SignalGroup;
    entryLadder?: LadderConfig;
    exitLadder?: LadderConfig;
}
export declare function simulateStrategy(candles: Candle[], strategy: Strategy[], stopLossConfig?: StopLossConfig, entryConfig?: EntryConfig, reEntryConfig?: ReEntryConfig, costConfig?: CostConfig, options?: SimulationStrategyOptions): SimulationResult;
//# sourceMappingURL=engine.d.ts.map