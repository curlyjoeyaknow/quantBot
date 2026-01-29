/**
 * RunSet Types
 *
 * A RunSet is a logical selection of runs/artifacts, not the data itself.
 * It's a named queryable set that can be regenerated any time.
 *
 * Core principle: Reference sets, not individual artifacts.
 *
 * @packageDocumentation
 */

/**
 * Dataset identifier
 *
 * Examples:
 * - ohlcv_v2_2025Q4
 * - alerts_v1_2025_may
 * - candles_birdeye_2025Q3
 */
export type DatasetId = string;

/**
 * Universe filter - defines which subset of data to include
 */
export interface UniverseFilter {
  /** Chain filter (e.g., 'solana', 'ethereum') */
  chains?: string[];

  /** Venue filter (e.g., 'raydium', 'orca') */
  venues?: string[];

  /** Token source filter (e.g., 'birdeye', 'dexscreener') */
  tokenSources?: string[];

  /** Caller set filter (e.g., ['whale_watcher', 'smart_money']) */
  callers?: string[];

  /** Minimum market cap (USD) */
  minMarketCap?: number;

  /** Maximum market cap (USD) */
  maxMarketCap?: number;

  /** Minimum volume (USD) */
  minVolume?: number;
}

/**
 * Time bounds for run selection
 */
export interface TimeBounds {
  /** Start timestamp (ISO 8601) */
  from: string;

  /** End timestamp (ISO 8601) */
  to: string;

  /** Alert window policy (e.g., 'pre_alert_260m', 'post_alert_1440m') */
  alertWindowPolicy?: string;
}

/**
 * Strategy filter
 */
export interface StrategyFilter {
  /** Strategy family (e.g., 'MultiTrade_20pctTrail_50pctDropRebound_24h') */
  strategyFamily?: string;

  /** Strategy hash (exact match) */
  strategyHash?: string;

  /** Engine version (e.g., '1.0.0') */
  engineVersion?: string;

  /** Parameter constraints (e.g., { trailingStop: { min: 0.1, max: 0.3 } }) */
  paramConstraints?: Record<string, { min?: number; max?: number; eq?: unknown }>;
}

/**
 * RunSet specification (pure, declarative)
 *
 * This is the input to the resolver.
 * It describes WHAT you want, not WHERE it is.
 */
export interface RunSetSpec {
  /** RunSet ID (unique identifier) */
  runsetId: string;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Dataset ID (e.g., 'ohlcv_v2_2025Q4') */
  datasetId: DatasetId;

  /** Universe filter (which subset of data) */
  universe?: UniverseFilter;

  /** Time bounds */
  timeBounds: TimeBounds;

  /** Strategy filter */
  strategy?: StrategyFilter;

  /** Optional tags (e.g., ['baseline', 'ablation', 'paper_fig_2']) */
  tags?: string[];

  /** Use latest semantics (exploration mode) */
  latest?: boolean;

  /** Frozen (reproducibility mode) - if true, resolution is pinned */
  frozen?: boolean;

  /** Explicit run IDs (for pinned mode) */
  runIds?: string[];

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Spec version (for schema evolution) */
  specVersion: string;
}

/**
 * Resolved artifact reference
 */
export interface ResolvedArtifact {
  /** Artifact ID */
  artifactId: string;

  /** Artifact type (e.g., 'trades', 'metrics', 'curves') */
  kind: string;

  /** URI (Parquet file path, DuckDB table, etc.) */
  uri: string;

  /** Content hash (for verification) */
  contentHash: string;

  /** Dataset ID (if part of a dataset) */
  datasetId?: DatasetId;

  /** Run ID (if part of a run) */
  runId?: string;
}

/**
 * RunSet resolution result
 *
 * This is the output from the resolver.
 * It's the concrete list of artifacts that match the RunSet spec.
 */
export interface RunSetResolution {
  /** RunSet ID */
  runsetId: string;

  /** Resolver version (for auditing) */
  resolverVersion: string;

  /** Resolution timestamp (ISO 8601) */
  resolvedAt: string;

  /** List of run IDs that match the spec */
  runIds: string[];

  /** List of resolved artifacts */
  artifacts: ResolvedArtifact[];

  /** Content hash of the resolved list (for verification) */
  contentHash: string;

  /** Resolution metadata (counts, coverage, etc.) */
  metadata: {
    /** Total number of runs */
    runCount: number;

    /** Total number of artifacts */
    artifactCount: number;

    /** Coverage summary */
    coverage?: {
      /** Date range covered */
      dateRange: { from: string; to: string };

      /** Number of unique tokens */
      tokenCount?: number;

      /** Number of unique callers */
      callerCount?: number;
    };

    /** Resolution warnings (e.g., missing data, partial coverage) */
    warnings?: string[];
  };

  /** Frozen (if true, this resolution is pinned) */
  frozen: boolean;
}

/**
 * Dataset metadata
 */
export interface Dataset {
  /** Dataset ID (unique identifier) */
  datasetId: DatasetId;

  /** Dataset kind (e.g., 'ohlcv', 'alerts', 'candles') */
  kind: string;

  /** Schema version */
  schemaVersion: string;

  /** Source provenance (e.g., 'birdeye', 'clickhouse_export') */
  provenance: {
    /** Source system */
    source: string;

    /** Extraction timestamp */
    extractedAt: string;

    /** Git commit hash (if applicable) */
    gitCommit?: string;
  };

  /** Coverage policy snapshot */
  coverage: {
    /** Date range */
    dateRange: { from: string; to: string };

    /** Chains covered */
    chains?: string[];

    /** Venues covered */
    venues?: string[];

    /** Completeness (0.0 to 1.0) */
    completeness?: number;
  };

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Dataset metadata (flexible) */
  metadata?: Record<string, unknown>;
}

/**
 * Run metadata
 */
export interface Run {
  /** Run ID (unique identifier) */
  runId: string;

  /** Dataset IDs used as input */
  datasetIds: DatasetId[];

  /** Strategy hash (sha256 of StrategySpec) */
  strategyHash: string;

  /** Engine version */
  engineVersion: string;

  /** Run status */
  status: 'pending' | 'running' | 'completed' | 'failed';

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Completion timestamp (ISO 8601) */
  completedAt?: string;

  /** Run metadata (flexible) */
  metadata?: Record<string, unknown>;
}

/**
 * RunSet mode
 */
export type RunSetMode = 'exploration' | 'reproducible';

/**
 * RunSet with resolution
 */
export interface RunSetWithResolution {
  /** RunSet specification */
  spec: RunSetSpec;

  /** Latest resolution (if resolved) */
  resolution?: RunSetResolution;

  /** Mode (exploration or reproducible) */
  mode: RunSetMode;
}

