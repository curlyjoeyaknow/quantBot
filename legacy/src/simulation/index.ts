import { SimulationEngine, ScenarioRunSummary } from './engine';
import { parseSimulationConfig, SimulationEngineConfig } from './config';
import { DefaultTargetResolver, ScenarioTargetResolver } from './target-resolver';
import { ConfigDrivenSink } from './sinks';

export {
  SimulationEngine,
  simulateStrategy,
  Strategy,
  SimulationTarget,
  ScenarioRunSummary,
} from './engine';
export {
  parseSimulationConfig,
  SimulationConfigSchema,
  SimulationScenarioConfig,
  SimulationEngineConfig,
} from './config';
export { DefaultTargetResolver, ScenarioTargetResolver } from './target-resolver';
export { ConfigDrivenSink } from './sinks';

export async function runSimulationConfig(
  config: SimulationEngineConfig,
  options: {
    resolver?: ScenarioTargetResolver;
    engine?: SimulationEngine;
  } = {},
): Promise<ScenarioRunSummary[]> {
  const resolver = options.resolver ?? new DefaultTargetResolver();
  const engine =
    options.engine ??
    new SimulationEngine({
      defaults: config.global.defaults,
      sinks: [
        new ConfigDrivenSink({
          defaultOutputs: config.global.defaults.outputs,
        }),
      ],
    });

  const summaries: ScenarioRunSummary[] = [];

  for (const scenario of config.scenarios) {
    const targets = await resolver.resolve(scenario);
    const summary = await engine.runScenario({
      scenario,
      targets,
      runOptions: config.global.run,
      overrides: config.global.defaults,
    });
    summaries.push(summary);
  }

  return summaries;
}

export function loadSimulationConfig(raw: unknown): SimulationEngineConfig {
  return parseSimulationConfig(raw);
}

