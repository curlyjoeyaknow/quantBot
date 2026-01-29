/**
 * RunSet Resolver Port
 *
 * The Resolver is the ONLY convenience layer allowed to touch truth.
 * It takes a RunSet spec and produces concrete URIs.
 *
 * Resolver contract:
 * - Deterministic: same inputs ⇒ same resolved list (unless using latest=true)
 * - Versioned: outputs carry resolver_version
 * - Auditable: writes a resolution record
 *
 * Think of it like DNS for your data lake.
 *
 * @packageDocumentation
 */

import type {
  RunSetSpec,
  RunSetResolution,
  RunSetWithResolution,
  Dataset,
  Run,
  DatasetId,
} from '../types/runset.js';

/**
 * RunSet creation request
 */
export interface CreateRunSetRequest {
  /** RunSet specification */
  spec: RunSetSpec;

  /** Auto-resolve after creation */
  autoResolve?: boolean;
}

/**
 * RunSet query filter
 */
export interface RunSetQueryFilter {
  /** Filter by tags */
  tags?: string[];

  /** Filter by dataset ID */
  datasetId?: DatasetId;

  /** Filter by frozen status */
  frozen?: boolean;

  /** Filter by mode */
  mode?: 'exploration' | 'reproducible';

  /** Limit number of results */
  limit?: number;
}

/**
 * RunSet Resolver Port
 *
 * Provides RunSet management and resolution.
 *
 * The Resolver is allowed to:
 * - Find data
 * - Select data
 * - Cache data
 * - Index metadata
 * - Summarize results
 *
 * The Resolver is NOT allowed to:
 * - Alter canonical events
 * - Alter OHLCV truth
 * - Infer missing candles
 * - "Repair" gaps silently
 * - Rewrite run outputs in place
 * - Compute trading outcomes without engine replay
 *
 * If convenience changes the timeline, you've crossed into fake backtesting.
 *
 * @example
 * ```typescript
 * const resolver = ctx.services.runsetResolver();
 *
 * // Create RunSet
 * const runset = await resolver.createRunSet({
 *   spec: {
 *     runsetId: 'brook_baseline_2025Q4',
 *     name: 'Brook Baseline Q4 2025',
 *     datasetId: 'ohlcv_v2_2025Q4',
 *     timeBounds: { from: '2025-10-01', to: '2025-12-31' },
 *     universe: { callers: ['whale_watcher'] },
 *     strategy: { strategyFamily: 'MultiTrade_20pctTrail' },
 *     createdAt: new Date().toISOString(),
 *     specVersion: '1.0.0',
 *   },
 *   autoResolve: true,
 * });
 *
 * // Resolve RunSet (find matching runs)
 * const resolution = await resolver.resolveRunSet('brook_baseline_2025Q4');
 *
 * // Freeze RunSet (pin for reproducibility)
 * await resolver.freezeRunSet('brook_baseline_2025Q4');
 *
 * // Query RunSets
 * const runsets = await resolver.queryRunSets({
 *   tags: ['baseline'],
 *   frozen: true,
 * });
 * ```
 */
export interface RunSetResolverPort {
  /**
   * Create a new RunSet
   *
   * @param request - RunSet creation request
   * @returns Created RunSet with optional resolution
   */
  createRunSet(request: CreateRunSetRequest): Promise<RunSetWithResolution>;

  /**
   * Get RunSet by ID
   *
   * @param runsetId - RunSet ID
   * @returns RunSet with latest resolution
   * @throws Error if RunSet not found
   */
  getRunSet(runsetId: string): Promise<RunSetWithResolution>;

  /**
   * Query RunSets
   *
   * @param filter - Query filter
   * @returns Array of matching RunSets
   */
  queryRunSets(filter: RunSetQueryFilter): Promise<RunSetWithResolution[]>;

  /**
   * Resolve RunSet (find matching runs and artifacts)
   *
   * This is the core Resolver operation.
   * It takes a RunSet spec and produces concrete URIs.
   *
   * Behavior:
   * - If frozen=true: returns pinned resolution
   * - If frozen=false: re-resolves based on current data
   * - If latest=true: uses latest available data
   * - If latest=false: uses pinned dataset versions
   *
   * @param runsetId - RunSet ID
   * @param force - Force re-resolution even if cached
   * @returns Resolution result
   */
  resolveRunSet(runsetId: string, force?: boolean): Promise<RunSetResolution>;

  /**
   * Freeze RunSet (pin resolution for reproducibility)
   *
   * Freezing a RunSet:
   * - Pins the current resolution
   * - Sets frozen=true
   * - Stores resolution snapshot
   * - Future resolves return the pinned resolution
   *
   * This is the transition from exploration to reproducible mode.
   *
   * @param runsetId - RunSet ID
   * @returns Frozen resolution
   */
  freezeRunSet(runsetId: string): Promise<RunSetResolution>;

  /**
   * Unfreeze RunSet (allow re-resolution)
   *
   * @param runsetId - RunSet ID
   */
  unfreezeRunSet(runsetId: string): Promise<void>;

  /**
   * Delete RunSet
   *
   * @param runsetId - RunSet ID
   */
  deleteRunSet(runsetId: string): Promise<void>;

  /**
   * Register dataset
   *
   * Datasets are immutable collections of data.
   * If you "fix" OHLCV, that's a new dataset_id. Period.
   *
   * @param dataset - Dataset metadata
   */
  registerDataset(dataset: Dataset): Promise<void>;

  /**
   * Get dataset by ID
   *
   * @param datasetId - Dataset ID
   * @returns Dataset metadata
   * @throws Error if dataset not found
   */
  getDataset(datasetId: DatasetId): Promise<Dataset>;

  /**
   * List datasets
   *
   * @param filter - Optional filter
   * @returns Array of datasets
   */
  listDatasets(filter?: { kind?: string; limit?: number }): Promise<Dataset[]>;

  /**
   * Register run
   *
   * Runs are immutable execution records.
   * Each run has a unique run_id and references dataset_ids.
   *
   * @param run - Run metadata
   */
  registerRun(run: Run): Promise<void>;

  /**
   * Get run by ID
   *
   * @param runId - Run ID
   * @returns Run metadata
   * @throws Error if run not found
   */
  getRun(runId: string): Promise<Run>;

  /**
   * List runs
   *
   * @param filter - Optional filter
   * @returns Array of runs
   */
  listRuns(filter?: {
    datasetIds?: DatasetId[];
    strategyHash?: string;
    status?: string;
    limit?: number;
  }): Promise<Run[]>;

  /**
   * Get resolution history for a RunSet
   *
   * @param runsetId - RunSet ID
   * @param limit - Maximum number of resolutions to return
   * @returns Array of resolutions (newest first)
   */
  getResolutionHistory(runsetId: string, limit?: number): Promise<RunSetResolution[]>;

  /**
   * Validate RunSet spec
   *
   * @param spec - RunSet specification
   * @returns Validation result
   */
  validateSpec(spec: RunSetSpec): Promise<{
    valid: boolean;
    errors?: string[];
    warnings?: string[];
  }>;

  /**
   * Check if resolver is available
   *
   * @returns True if resolver is accessible
   */
  isAvailable(): Promise<boolean>;
}

