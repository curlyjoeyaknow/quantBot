/**
 * Experiment Repository Port
 *
 * Interface for querying experiment data.
 */

import { DateTime } from 'luxon';

/**
 * Experiment metadata (subset of SimulationRunMetadata with experiment tracking fields)
 */
export interface ExperimentMetadata {
  id?: number;
  strategyId?: number;
  tokenId?: number;
  callerId?: number;
  runType: 'backtest' | 'optimization' | 'live';
  engineVersion: string;
  configHash: string;
  config: Record<string, unknown>;
  dataSelection: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: DateTime;
  completedAt?: DateTime;
  errorMessage?: string;

  // Experiment tracking fields
  experimentId?: string;
  gitCommitHash?: string;
  dataSnapshotHash?: string;
  parameterVectorHash?: string;
  randomSeed?: number;
  contractVersion?: string;
  strategyVersion?: string;
  dataVersion?: string;
}

/**
 * Experiment query filter
 */
export interface ExperimentQueryFilter {
  /** Filter by experiment ID */
  experimentId?: string;
  /** Filter by strategy ID */
  strategyId?: string;
  /** Filter by parameter vector hash (find experiments with same parameters) */
  parameterVectorHash?: string;
  /** Filter by git commit hash (find experiments from same code version) */
  gitCommitHash?: string;
  /** Filter by data snapshot hash (find experiments using same data) */
  dataSnapshotHash?: string;
  /** Filter by status */
  status?: 'pending' | 'running' | 'completed' | 'failed';
  /** Filter by time range - start timestamp (ISO string) */
  startedAfter?: string;
  /** Filter by time range - end timestamp (ISO string) */
  startedBefore?: string;
  /** Limit number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Experiment query result
 */
export interface ExperimentQueryResult {
  /** List of experiments matching the filter */
  experiments: ExperimentMetadata[];
  /** Total count (before limit/offset) */
  total: number;
}

/**
 * Experiment Repository Port
 *
 * Interface for querying experiment data from storage.
 */
export interface ExperimentRepository {
  /**
   * Get experiment by ID
   *
   * @param experimentId - Experiment ID
   * @returns Experiment metadata or null if not found
   */
  get(experimentId: string): Promise<ExperimentMetadata | null>;

  /**
   * List experiments matching filter
   *
   * @param filter - Query filter
   * @returns Query result with experiments and total count
   */
  list(filter?: ExperimentQueryFilter): Promise<ExperimentQueryResult>;

  /**
   * Find experiments by parameter vector hash
   *
   * @param parameterVectorHash - Parameter vector hash
   * @param limit - Maximum number of results
   * @returns List of experiments with same parameters
   */
  getByParameterHash(parameterVectorHash: string, limit?: number): Promise<ExperimentMetadata[]>;

  /**
   * Find experiments by git commit hash
   *
   * @param gitCommitHash - Git commit hash
   * @param limit - Maximum number of results
   * @returns List of experiments from same code version
   */
  getByGitCommit(gitCommitHash: string, limit?: number): Promise<ExperimentMetadata[]>;

  /**
   * Find experiments by data snapshot hash
   *
   * @param dataSnapshotHash - Data snapshot hash
   * @param limit - Maximum number of results
   * @returns List of experiments using same data
   */
  getByDataSnapshot(dataSnapshotHash: string, limit?: number): Promise<ExperimentMetadata[]>;
}
