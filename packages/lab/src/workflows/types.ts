// Import types directly from storage package (using package exports)
// Using type-only imports to avoid runtime dependency issues
import type { FeatureSpecV1 } from '@quantbot/storage/ports/FeatureComputePort';
import type { StrategySpecV1, RiskSpecV1 } from '@quantbot/storage/ports/SimulationPort';

export interface SimPresetV1 {
  kind: 'sim_preset_v1';
  name: string;
  description?: string;
  data: {
    dataset: 'candles_1m' | 'candles_5m';
    chain: 'sol' | 'eth' | 'base' | 'bsc';
    interval: '1m' | '5m' | '1h' | '1d';
    time_range: { start: string; end: string };
    tokens_file: string;
  };
  features: FeatureSpecV1;
  strategy: StrategySpecV1;
  risk: RiskSpecV1;
}

export interface LabPorts {
  slice: import('@quantbot/storage/ports/CandleSlicePort').CandleSlicePort;
  features: import('@quantbot/storage/ports/FeatureComputePort').FeatureComputePort;
  simulation: import('@quantbot/storage/ports/SimulationPort').SimulationPort;
  leaderboard: import('@quantbot/storage/ports/LeaderboardPort').LeaderboardPort;
}

export type RunContext = import('@quantbot/storage/ports/CandleSlicePort').RunContext;
