export interface RunContext {
  runId: string;
  createdAtIso: string;
  note?: string;
}

export interface CandleSliceSpec {
  dataset: 'candles_1m' | 'candles_5m';
  chain: 'sol' | 'eth' | 'base' | 'bsc';
  interval: '1m' | '5m' | '1h' | '1d';
  startIso: string;
  endIso: string;
  tokenIds: string[];
}

export interface SliceExportResult {
  manifestPath: string;
  parquetPaths: string[];
  sliceHash: string;
  rowCount?: number;
  /** Additive-only: deterministic schema fingerprint for join-safe reuse. */
  schemaHash?: string;
}

export interface CandleSlicePort {
  exportSlice(args: {
    run: RunContext;
    spec: CandleSliceSpec;
    artifactDir: string;
  }): Promise<SliceExportResult>;
}
