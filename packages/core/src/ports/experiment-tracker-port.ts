/**
 * Experiment Tracker Port
 *
 * Defines the interface for experiment tracking with artifact lineage.
 * Experiments declare frozen artifact sets, track execution status, and store output artifact IDs.
 *
 * @packageDocumentation
 */

/**
 * Experiment status lifecycle
 */
export type ExperimentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Experiment definition - input for creating a new experiment
 */
export interface ExperimentDefinition {
  /** Unique experiment identifier */
  experimentId: string;

  /** Human-readable experiment name */
  name: string;

  /** Optional description */
  description?: string;

  /** Input artifacts (frozen artifact set) */
  inputs: {
    /** Alert artifact IDs */
    alerts: string[];
    /** OHLCV artifact IDs */
    ohlcv: string[];
    /** Strategy artifact IDs (optional) */
    strategies?: string[];
  };

  /** Experiment configuration */
  config: {
    /** Strategy configuration */
    strategy: Record<string, unknown>;
    /** Date range for experiment */
    dateRange: { from: string; to: string };
    /** Additional parameters */
    params: Record<string, unknown>;
  };

  /** Provenance information */
  provenance: {
    /** Git commit hash */
    gitCommit: string;
    /** Whether git working directory was dirty */
    gitDirty: boolean;
    /** Engine version */
    engineVersion: string;
    /** Creation timestamp (ISO 8601) */
    createdAt: string;
  };
}

/**
 * Full experiment record with status and outputs
 */
export interface Experiment extends ExperimentDefinition {
  /** Current experiment status */
  status: ExperimentStatus;

  /** Output artifact IDs (populated after completion) */
  outputs?: {
    /** Trades artifact ID */
    trades?: string;
    /** Metrics artifact ID */
    metrics?: string;
    /** Curves artifact ID */
    curves?: string;
    /** Diagnostics artifact ID */
    diagnostics?: string;
  };

  /** Execution metadata */
  execution?: {
    /** Start timestamp (ISO 8601) */
    startedAt: string;
    /** Completion timestamp (ISO 8601) */
    completedAt?: string;
    /** Duration in milliseconds */
    duration?: number;
    /** Error message (if failed) */
    error?: string;
  };
}

/**
 * Filter for querying experiments
 */
export interface ExperimentFilter {
  /** Filter by status */
  status?: ExperimentStatus;
  /** Filter by artifact type in inputs */
  artifactType?: string;
  /** Filter by git commit */
  gitCommit?: string;
  /** Filter by minimum creation date (ISO 8601) */
  minCreatedAt?: string;
  /** Filter by maximum creation date (ISO 8601) */
  maxCreatedAt?: string;
  /** Limit number of results */
  limit?: number;
}

/**
 * Experiment results - output artifact IDs
 */
export interface ExperimentResults {
  /** Trades artifact ID */
  tradesArtifactId?: string;
  /** Metrics artifact ID */
  metricsArtifactId?: string;
  /** Curves artifact ID */
  curvesArtifactId?: string;
  /** Diagnostics artifact ID */
  diagnosticsArtifactId?: string;
}

/**
 * Experiment Tracker Port
 *
 * Provides experiment tracking with artifact lineage.
 * Experiments declare frozen artifact sets, track execution status, and store output artifact IDs.
 *
 * @example
 * ```typescript
 * const tracker = ctx.services.experimentTracker();
 *
 * // Create experiment
 * const experiment = await tracker.createExperiment({
 *   experimentId: 'exp-123',
 *   name: 'Momentum Strategy Test',
 *   inputs: {
 *     alerts: ['alert-1', 'alert-2'],
 *     ohlcv: ['ohlcv-1'],
 *   },
 *   config: {
 *     strategy: { name: 'momentum', threshold: 0.05 },
 *     dateRange: { from: '2025-01-01', to: '2025-01-31' },
 *     params: {},
 *   },
 *   provenance: {
 *     gitCommit: 'abc123',
 *     gitDirty: false,
 *     engineVersion: '1.0.0',
 *     createdAt: new Date().toISOString(),
 *   },
 * });
 *
 * // Update status
 * await tracker.updateStatus('exp-123', 'running');
 *
 * // Store results
 * await tracker.storeResults('exp-123', {
 *   tradesArtifactId: 'trades-123',
 *   metricsArtifactId: 'metrics-456',
 * });
 *
 * // Find experiments by input artifacts
 * const experiments = await tracker.findByInputArtifacts(['alert-1']);
 * ```
 */
export interface ExperimentTrackerPort {
  /**
   * Create a new experiment
   *
   * @param definition - Experiment definition
   * @returns Created experiment with initial status 'pending'
   */
  createExperiment(definition: ExperimentDefinition): Promise<Experiment>;

  /**
   * Get experiment by ID
   *
   * @param experimentId - Experiment ID
   * @returns Experiment record
   * @throws Error if experiment not found
   */
  getExperiment(experimentId: string): Promise<Experiment>;

  /**
   * List experiments matching filter
   *
   * @param filter - Query filter
   * @returns Array of matching experiments
   */
  listExperiments(filter: ExperimentFilter): Promise<Experiment[]>;

  /**
   * Update experiment status
   *
   * @param experimentId - Experiment ID
   * @param status - New status
   */
  updateStatus(experimentId: string, status: ExperimentStatus): Promise<void>;

  /**
   * Store experiment results (output artifact IDs)
   *
   * @param experimentId - Experiment ID
   * @param results - Output artifact IDs
   */
  storeResults(experimentId: string, results: ExperimentResults): Promise<void>;

  /**
   * Find experiments by input artifact IDs
   *
   * Useful for lineage queries: "which experiments used this artifact?"
   *
   * @param artifactIds - Array of artifact IDs to search for
   * @returns Array of experiments that use any of the specified artifacts
   */
  findByInputArtifacts(artifactIds: string[]): Promise<Experiment[]>;
}
