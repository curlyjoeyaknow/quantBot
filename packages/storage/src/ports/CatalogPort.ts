/**
 * Catalog Port - Index for reusable artifacts
 *
 * The catalogue tracks:
 * - Token sets (stable IDs from sorted token lists)
 * - Slices (dataset + time range + token set + schema)
 * - Feature sets (feature spec hashes)
 * - Features (slice + feature set combinations)
 * - Simulation runs (features + strategy + risk + window)
 */

export interface TokenSetRecord {
  tokenSetId: string;
  sourcePath: string;
  tokenCount: number;
  tokensSha: string;
  createdAtIso: string;
}

export interface SliceRecord {
  sliceId: string;
  dataset: string;
  chain: string;
  interval: string;
  startIso: string;
  endIso: string;
  tokenSetId: string;
  schemaHash: string;
  sliceHash: string;
  manifestPath: string;
  createdAtIso: string;
}

export interface FeatureSetRecord {
  featureSetId: string;
  featureSpecHash: string;
  featureSpecJson: string;
  featureSetVersion?: string; // Version of the feature set (default: '1.0.0')
  featureSpecVersion?: string; // DSL version of the feature spec (default: '1.0.0')
  computedAtIso?: string; // When features were computed (default: createdAtIso)
  computedBy?: string; // Git commit hash that computed these features
  createdAtIso: string;
}

export interface FeaturesRecord {
  featuresId: string;
  sliceId: string;
  featureSetId: string;
  manifestPath: string;
  parquetPath: string;
  featureSetVersion?: string; // Version of the feature set (default: '1.0.0')
  computedAtIso?: string; // When features were computed (default: createdAtIso)
  computedBy?: string; // Git commit hash that computed these features
  createdAtIso: string;
}

export interface SimRunRecord {
  simId: string;
  featuresId: string;
  strategyHash: string;
  riskHash: string;
  windowId?: string;
  summaryPath: string;
  artifactDir: string;
  codeVersion: string;
  createdAtIso: string;
}

export interface CatalogPort {
  // Token sets
  upsertTokenSet(r: TokenSetRecord): Promise<void>;
  getTokenSet(tokenSetId: string): Promise<TokenSetRecord | null>;

  // Slices
  upsertSlice(r: SliceRecord): Promise<void>;
  findSlice(args: {
    dataset: string;
    chain: string;
    interval: string;
    startIso: string;
    endIso: string;
    tokenSetId: string;
    schemaHash: string;
  }): Promise<SliceRecord | null>;

  // Feature sets
  upsertFeatureSet(r: FeatureSetRecord): Promise<void>;
  getFeatureSet(featureSetId: string): Promise<FeatureSetRecord | null>;

  // Features (slice + feature set)
  upsertFeatures(r: FeaturesRecord): Promise<void>;
  findFeatures(args: { sliceId: string; featureSetId: string }): Promise<FeaturesRecord | null>;

  // Sim runs
  upsertSimRun(r: SimRunRecord): Promise<void>;
}
