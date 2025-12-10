import { SimulationEngine, ScenarioRunSummary } from './engine';
import { SimulationEngineConfig } from './config';
import { ScenarioTargetResolver } from './target-resolver';
export { SimulationEngine, simulateStrategy, Strategy, SimulationTarget, ScenarioRunSummary, } from './engine';
export { parseSimulationConfig, SimulationConfigSchema, SimulationScenarioConfig, SimulationEngineConfig, } from './config';
export { DefaultTargetResolver, ScenarioTargetResolver } from './target-resolver';
export { ConfigDrivenSink } from './sinks';
export declare function runSimulationConfig(config: SimulationEngineConfig, options?: {
    resolver?: ScenarioTargetResolver;
    engine?: SimulationEngine;
}): Promise<ScenarioRunSummary[]>;
export declare function loadSimulationConfig(raw: unknown): SimulationEngineConfig;
//# sourceMappingURL=index.d.ts.map