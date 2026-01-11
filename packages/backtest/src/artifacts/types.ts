/**
 * Artifact Types and Schemas
 *
 * Defines the structure of all backtest run artifacts.
 * Each artifact type is a narrow, purpose-built Parquet file.
 */

import { z } from 'zod';

// =============================================================================
// Artifact Type Enum
// =============================================================================

export const ArtifactType = {
  // Inputs
  ALERTS: 'alerts',
  
  // Truth layer (path metrics)
  PATHS: 'paths',
  
  // Features (derived columns)
  FEATURES: 'features',
  
  // Policy simulation
  TRADES: 'trades',
  
  // Summary metrics
  SUMMARY: 'summary',
  
  // Optimization frontier
  FRONTIER: 'frontier',
  
  // Errors and warnings
  ERRORS: 'errors',
} as const;

export type ArtifactType = typeof ArtifactType[keyof typeof ArtifactType];

// =============================================================================
// Artifact Schemas (for validation and documentation)
// =============================================================================

/**
 * alerts.parquet - Input calls/alerts for the run
 */
export const AlertArtifactSchema = z.object({
  call_id: z.string(),
  mint: z.string(),
  caller_name: z.string(),
  chain: z.string(),
  alert_ts_ms: z.number(),
  created_at: z.string(), // ISO timestamp
  // Additional fields as needed
});

export type AlertArtifact = z.infer<typeof AlertArtifactSchema>;

/**
 * paths.parquet - Truth layer outputs (ATH, drawdowns, time-to-multiples)
 */
export const PathArtifactSchema = z.object({
  run_id: z.string(),
  call_id: z.string(),
  caller_name: z.string(),
  mint: z.string(),
  chain: z.string(),
  interval: z.string(),
  
  // Alert context
  alert_ts_ms: z.number(),
  p0: z.number(), // Entry price
  
  // Multiple hits
  hit_2x: z.boolean(),
  t_2x_ms: z.number().nullable(),
  hit_3x: z.boolean(),
  t_3x_ms: z.number().nullable(),
  hit_4x: z.boolean(),
  t_4x_ms: z.number().nullable(),
  
  // Drawdowns
  dd_bps: z.number(), // Initial drawdown from alert
  dd_to_2x_bps: z.number().nullable(), // Drawdown before hitting 2x
  
  // Timing
  alert_to_activity_ms: z.number().nullable(),
  
  // Peak
  peak_multiple: z.number(),
});

export type PathArtifact = z.infer<typeof PathArtifactSchema>;

/**
 * features.parquet - Derived feature columns (for ML/analysis)
 */
export const FeatureArtifactSchema = z.object({
  run_id: z.string(),
  call_id: z.string(),
  
  // Feature columns (extensible)
  // Examples:
  // volatility_pre_alert: z.number().optional(),
  // volume_spike: z.number().optional(),
  // caller_historical_accuracy: z.number().optional(),
  
  // Placeholder for now
  features: z.record(z.string(), z.unknown()).optional(),
});

export type FeatureArtifact = z.infer<typeof FeatureArtifactSchema>;

/**
 * trades.parquet - Policy simulation events/fills
 */
export const TradeArtifactSchema = z.object({
  run_id: z.string(),
  policy_id: z.string().optional(),
  call_id: z.string(),
  
  // Entry
  entry_ts_ms: z.number(),
  entry_px: z.number(),
  
  // Exit
  exit_ts_ms: z.number(),
  exit_px: z.number(),
  exit_reason: z.string().nullable(),
  
  // Performance
  realized_return_bps: z.number(),
  stop_out: z.boolean(),
  max_adverse_excursion_bps: z.number(),
  time_exposed_ms: z.number(),
  tail_capture: z.number().nullable(),
});

export type TradeArtifact = z.infer<typeof TradeArtifactSchema>;

/**
 * summary.parquet - One-row aggregate metrics
 */
export const SummaryArtifactSchema = z.object({
  run_id: z.string(),
  
  // Counts
  calls_processed: z.number(),
  calls_excluded: z.number(),
  trades_count: z.number(),
  
  // Returns
  avg_return_bps: z.number(),
  median_return_bps: z.number(),
  p25_return_bps: z.number().optional(),
  p75_return_bps: z.number().optional(),
  p90_return_bps: z.number().optional(),
  
  // Risk
  stop_out_rate: z.number(),
  avg_max_adverse_excursion_bps: z.number(),
  
  // Timing
  avg_time_exposed_ms: z.number(),
  median_time_exposed_ms: z.number().optional(),
  
  // Tail capture
  avg_tail_capture: z.number().nullable(),
  median_tail_capture: z.number().nullable(),
});

export type SummaryArtifact = z.infer<typeof SummaryArtifactSchema>;

/**
 * frontier.parquet - Optimization candidates with scores
 */
export const FrontierArtifactSchema = z.object({
  run_id: z.string(),
  caller_name: z.string(),
  
  // Policy parameters (serialized)
  policy_params: z.string(), // JSON string
  
  // Constraints
  meets_constraints: z.boolean(),
  
  // Scores
  objective_score: z.number(),
  avg_return_bps: z.number(),
  median_return_bps: z.number(),
  stop_out_rate: z.number(),
  
  // Ranking
  rank: z.number().optional(),
});

export type FrontierArtifact = z.infer<typeof FrontierArtifactSchema>;

/**
 * errors.parquet - Errors and warnings during run
 */
export const ErrorArtifactSchema = z.object({
  run_id: z.string(),
  timestamp: z.string(), // ISO timestamp
  level: z.enum(['error', 'warning', 'info']),
  phase: z.string(), // 'plan', 'coverage', 'slice', 'execution', 'optimization'
  call_id: z.string().optional(),
  message: z.string(),
  details: z.string().optional(), // JSON string
});

export type ErrorArtifact = z.infer<typeof ErrorArtifactSchema>;

// =============================================================================
// Run Manifest Schema
// =============================================================================

/**
 * run.json - Metadata and provenance for the run
 */
export const RunManifestSchema = z.object({
  // Identity
  run_id: z.string(),
  run_type: z.enum(['path-only', 'policy', 'optimization', 'full']),
  
  // Timestamps
  created_at: z.string(), // ISO timestamp
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  
  // Status
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  
  // Provenance
  git_commit: z.string().optional(),
  git_branch: z.string().optional(),
  git_dirty: z.boolean().optional(),
  
  // Dataset window
  dataset: z.object({
    from: z.string().optional(), // ISO timestamp
    to: z.string().optional(),
    interval: z.string(),
    calls_count: z.number(),
  }),
  
  // Parameters (hashed for reproducibility)
  parameters: z.object({
    strategy_id: z.string().optional(),
    policy_id: z.string().optional(),
    config_hash: z.string().optional(),
    // Extensible
  }).passthrough(),
  
  // Schema versions (for forward compatibility)
  schema_version: z.object({
    manifest: z.string().default('1.0.0'),
    artifacts: z.string().default('1.0.0'),
  }),
  
  // Artifact inventory
  artifacts: z.object({
    alerts: z.object({ rows: z.number(), path: z.string() }).optional(),
    paths: z.object({ rows: z.number(), path: z.string() }).optional(),
    features: z.object({ rows: z.number(), path: z.string() }).optional(),
    trades: z.object({ rows: z.number(), path: z.string() }).optional(),
    summary: z.object({ rows: z.number(), path: z.string() }).optional(),
    frontier: z.object({ rows: z.number(), path: z.string() }).optional(),
    errors: z.object({ rows: z.number(), path: z.string() }).optional(),
  }),
  
  // Timing
  timing: z.object({
    plan_ms: z.number().optional(),
    coverage_ms: z.number().optional(),
    slice_ms: z.number().optional(),
    execution_ms: z.number().optional(),
    optimization_ms: z.number().optional(),
    total_ms: z.number().optional(),
  }).optional(),
  
  // Logs
  logs: z.object({
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  }).optional(),
});

export type RunManifest = z.infer<typeof RunManifestSchema>;

// =============================================================================
// Artifact Metadata (per artifact file)
// =============================================================================

/**
 * Metadata embedded in Parquet file metadata or sidecar
 */
export interface ArtifactMetadata {
  artifact_type: ArtifactType;
  run_id: string;
  created_at: string;
  rows: number;
  schema_version: string;
}

