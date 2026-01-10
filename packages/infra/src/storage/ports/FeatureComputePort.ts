import type { RunContext } from './CandleSlicePort.js';

export interface FeatureSpecV1 {
  timeframe: '1m' | '5m' | '1h' | '1d';
  groups: Array<{
    name: string;
    indicators: Array<Record<string, any>>;
  }>;
}

export interface FeatureComputeResult {
  featureSetId: string;
  featuresParquetPath: string;
  manifestPath: string;
}

export interface FeatureComputePort {
  compute(args: {
    run: RunContext;
    sliceManifestPath: string;
    sliceHash: string;
    featureSpec: FeatureSpecV1;
    artifactDir: string;
  }): Promise<FeatureComputeResult>;
}
