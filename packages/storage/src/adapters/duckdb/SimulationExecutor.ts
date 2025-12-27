import crypto from 'node:crypto';
import type {
  SimulationPort,
  SimulationResult,
  StrategySpecV1,
  RiskSpecV1,
} from '../../ports/SimulationPort.js';
import type { FeatureComputeResult } from '../../ports/FeatureComputePort.js';
import type { RunContext } from '../../ports/CandleSlicePort.js';

function sha(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export class SimulationExecutor implements SimulationPort {
  // TODO: inject DuckDB or your existing simulation engine (preferred)
  constructor(/* deps */) {}

  async run(args: {
    run: RunContext;
    presetName: string;
    windowId?: string;
    sliceManifestPath: string;
    sliceHash: string;
    features: FeatureComputeResult;
    strategy: StrategySpecV1;
    risk: RiskSpecV1;
    artifactDir: string;
  }): Promise<SimulationResult> {
    void args;

    // TODO:
    // - compile strategy graph (Phase 2)
    // - run deterministic kernel (Phase 3)
    // - write artifacts (fills/positions/events) + sim.summary.json
    const configHash = sha(JSON.stringify({ strategy: args.strategy, risk: args.risk }));

    const summary = {
      runId: args.run.runId,
      presetName: args.presetName,
      dataset: 'TODO',
      chain: 'TODO',
      interval: 'TODO',
      startIso: 'TODO',
      endIso: 'TODO',
      tokens: 0,
      trades: 0,
      pnlQuote: 0,
      maxDrawdownQuote: 0,
      winRate: 0,
      featureSetId: args.features.featureSetId,
      configHash,
      windowId: args.windowId,
      artifactDir: args.artifactDir,
      createdAtIso: args.run.createdAtIso,
    };

    return {
      summary,
      artifacts: {
        summaryJsonPath: `${args.artifactDir}/sim.summary.json`,
      },
    };
  }
}
