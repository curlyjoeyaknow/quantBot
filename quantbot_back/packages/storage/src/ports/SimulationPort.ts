import type { RunContext } from './CandleSlicePort.js';
import type { FeatureComputeResult } from './FeatureComputePort.js';

export type ConditionTree =
  | { all: ConditionTree[] }
  | { any: ConditionTree[] }
  | { gt: { a: string; b: number | string } }
  | { lt: { a: string; b: number | string } }
  | { cross_up: { a: string; b: string } }
  | { cross_down: { a: string; b: string } };

export interface StrategySpecV1 {
  entries: Array<{ name: string; when: ConditionTree }>;
  exits: Array<{ name: string; when: ConditionTree }>;
}

export interface RiskSpecV1 {
  position_size: { mode: 'fixed_quote'; quote: number };
  stop_loss:
    | { mode: 'atr_multiple'; atr: string; multiple: number }
    | { mode: 'trailing_percent'; percent: number }
    | { mode: 'fixed_percent'; percent: number };
  take_profit:
    | { mode: 'rr_multiple'; rr: number }
    | { mode: 'fixed_percent'; percent: number }
    | { mode: 'none' };
  max_hold_minutes?: number;
  allow_reentry?: boolean;
}

export interface SimSummaryV1 {
  runId: string;
  presetName: string;
  dataset: string;
  chain: string;
  interval: string;
  startIso: string;
  endIso: string;
  tokens: number;

  trades: number;
  pnlQuote: number;
  maxDrawdownQuote: number;
  winRate: number;

  featureSetId: string;
  configHash: string;
  windowId?: string;

  artifactDir: string;
  createdAtIso: string;
}

export interface SimulationResult {
  summary: SimSummaryV1;
  artifacts: {
    summaryJsonPath: string;
    fillsParquetPath?: string;
    positionsParquetPath?: string;
    eventsParquetPath?: string;
  };
}

export interface SimulationPort {
  run(args: {
    run: RunContext;
    presetName: string;
    windowId?: string;
    sliceManifestPath: string;
    sliceHash: string;
    features: FeatureComputeResult;
    strategy: StrategySpecV1;
    risk: RiskSpecV1;
    artifactDir: string;
  }): Promise<SimulationResult>;
}
