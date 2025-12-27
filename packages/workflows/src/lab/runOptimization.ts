import type { LabPorts, RunContext, SimPresetV1 } from './types.js';
import { runLabPreset } from './runLabPreset.js';

// Lab types - defined locally to avoid circular dependency
type ParameterSpaceDef = any;
type OptimizationConfig = any;
type ParameterConfig = any;

// Lazy load OptimizationEngine to avoid circular dependency
async function getOptimizationEngine(): Promise<any> {
  const importLab = new Function('return import("@quantbot/lab")');
  const labModule = await importLab();
  return labModule.OptimizationEngine;
}

/**
 * MVP optimization runner:
 * - generates candidate param configs
 * - for each candidate, derive a preset variant
 * - run lab preset
 * - leaderboard ingests results
 */
export async function runOptimization(args: {
  basePreset: SimPresetV1;
  parameterSpace: ParameterSpaceDef;
  optimizationConfig: OptimizationConfig;
  tokenIds: string[];
  ports: LabPorts;
  run: RunContext;
  artifactRootDir: string;
}) {
  const OptimizationEngine = await getOptimizationEngine();
  const engine = new OptimizationEngine();

  // Generate candidates using the optimization engine
  const candidates: ParameterConfig[] = [];
  await engine.optimize(
    args.parameterSpace,
    async (config: ParameterConfig) => {
      candidates.push(config);
      return { config }; // Placeholder evaluation
    },
    args.optimizationConfig
  );

  const results = [];
  for (let i = 0; i < candidates.length; i++) {
    const params = candidates[i]!;

    // TODO: apply params into basePreset (feature periods, thresholds, risk multipliers).
    // For now: just stamp variant name.
    const variant: SimPresetV1 = {
      ...args.basePreset,
      name: `${args.basePreset.name}__opt_${String(i).padStart(4, '0')}`,
      description: `opt params=${JSON.stringify(params)}`,
    };

    results.push(
      await runLabPreset({
        preset: variant,
        tokenIds: args.tokenIds,
        ports: args.ports,
        run: args.run,
        artifactRootDir: args.artifactRootDir,
      })
    );
  }

  return results;
}
