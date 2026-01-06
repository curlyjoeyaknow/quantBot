/**
 * Run Event Sourcing Domain Types
 *
 * Event sourcing for run orchestration and lineage tracking.
 * Events are append-only, immutable, and versioned.
 */

import { DateTime } from 'luxon';
import { z } from 'zod';

/**
 * Event type discriminator
 */
export type RunEventType =
  | 'RunCreated'
  | 'InputsResolved'
  | 'SliceGenerated'
  | 'SimulationStarted'
  | 'SimulationCompleted'
  | 'MetricsComputed'
  | 'ArtifactWritten'
  | 'RunFailed';

/**
 * Base event structure
 */
export interface RunEventBase {
  event_id: string; // UUID
  run_id: string; // UUID
  event_type: RunEventType;
  occurred_at: DateTime; // ISO timestamp
  event_version: number; // Schema version for this event type
  metadata?: Record<string, unknown>; // Free-form metadata
}

/**
 * RunCreated: Run was initialized
 */
export interface RunCreatedEvent extends RunEventBase {
  event_type: 'RunCreated';
  payload: {
    strategy_id: string;
    strategy_name: string;
    params_json: string;
    from_iso: string;
    to_iso: string;
    caller_name?: string;
    interval_sec: number;
    universe_ref?: string;
    notes?: string;
  };
}

/**
 * InputsResolved: All inputs (data snapshot, configs) have been resolved
 */
export interface InputsResolvedEvent extends RunEventBase {
  event_type: 'InputsResolved';
  payload: {
    code_version: string; // Git SHA
    config_hash: string; // Hash of all configs
    seed: number; // Random seed for determinism
    ports_snapshot_id?: string; // Reference to ports state snapshot
    data_snapshot_id?: string; // Reference to data snapshot
    strategy_config_hash: string;
    execution_model_hash?: string;
    cost_model_hash?: string;
    risk_model_hash?: string;
  };
}

/**
 * SliceGenerated: Dataset slice was created
 */
export interface SliceGeneratedEvent extends RunEventBase {
  event_type: 'SliceGenerated';
  payload: {
    slice_id: string;
    slice_path: string;
    token_count: number;
    time_range: {
      from_iso: string;
      to_iso: string;
    };
  };
}

/**
 * SimulationStarted: Simulation phase began
 */
export interface SimulationStartedEvent extends RunEventBase {
  event_type: 'SimulationStarted';
  payload: {
    phase: string; // e.g., 'single', 'batch', 'sweep'
    call_count?: number;
    batch_size?: number;
  };
}

/**
 * SimulationCompleted: Simulation phase finished
 */
export interface SimulationCompletedEvent extends RunEventBase {
  event_type: 'SimulationCompleted';
  payload: {
    phase: string;
    calls_attempted: number;
    calls_succeeded: number;
    calls_failed: number;
    trades_total: number;
    duration_ms: number;
  };
}

/**
 * MetricsComputed: Metrics were calculated
 */
export interface MetricsComputedEvent extends RunEventBase {
  event_type: 'MetricsComputed';
  payload: {
    metrics_type: string; // e.g., 'aggregate', 'per-call', 'time-series'
    pnl_stats?: {
      min?: number;
      max?: number;
      mean?: number;
      median?: number;
    };
    roi?: number;
    max_drawdown?: number;
    win_rate?: number;
  };
}

/**
 * ArtifactWritten: Artifact was persisted
 */
export interface ArtifactWrittenEvent extends RunEventBase {
  event_type: 'ArtifactWritten';
  payload: {
    artifact_type: string; // e.g., 'results', 'metrics', 'events', 'manifest'
    artifact_path: string;
    size_bytes?: number;
    content_hash?: string;
  };
}

/**
 * RunFailed: Run encountered an error
 */
export interface RunFailedEvent extends RunEventBase {
  event_type: 'RunFailed';
  payload: {
    error_code?: string;
    error_message: string;
    phase?: string; // Which phase failed
    stack_trace?: string;
  };
}

/**
 * Union type of all event types
 */
export type RunEvent =
  | RunCreatedEvent
  | InputsResolvedEvent
  | SliceGeneratedEvent
  | SimulationStartedEvent
  | SimulationCompletedEvent
  | MetricsComputedEvent
  | ArtifactWrittenEvent
  | RunFailedEvent;

/**
 * Event schema versions
 * Increment when event payload structure changes
 */
export const EVENT_SCHEMA_VERSIONS: Record<RunEventType, number> = {
  RunCreated: 1,
  InputsResolved: 1,
  SliceGenerated: 1,
  SimulationStarted: 1,
  SimulationCompleted: 1,
  MetricsComputed: 1,
  ArtifactWritten: 1,
  RunFailed: 1,
};

/**
 * Zod schemas for event validation
 */
export const RunCreatedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('RunCreated'),
  occurred_at: z.string(), // ISO string
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    strategy_id: z.string(),
    strategy_name: z.string(),
    params_json: z.string(),
    from_iso: z.string(),
    to_iso: z.string(),
    caller_name: z.string().optional(),
    interval_sec: z.number(),
    universe_ref: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const InputsResolvedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('InputsResolved'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    code_version: z.string(),
    config_hash: z.string(),
    seed: z.number(),
    ports_snapshot_id: z.string().optional(),
    data_snapshot_id: z.string().optional(),
    strategy_config_hash: z.string(),
    execution_model_hash: z.string().optional(),
    cost_model_hash: z.string().optional(),
    risk_model_hash: z.string().optional(),
  }),
});

export const SliceGeneratedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('SliceGenerated'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    slice_id: z.string(),
    slice_path: z.string(),
    token_count: z.number(),
    time_range: z.object({
      from_iso: z.string(),
      to_iso: z.string(),
    }),
  }),
});

export const SimulationStartedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('SimulationStarted'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    phase: z.string(),
    call_count: z.number().optional(),
    batch_size: z.number().optional(),
  }),
});

export const SimulationCompletedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('SimulationCompleted'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    phase: z.string(),
    calls_attempted: z.number(),
    calls_succeeded: z.number(),
    calls_failed: z.number(),
    trades_total: z.number(),
    duration_ms: z.number(),
  }),
});

export const MetricsComputedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('MetricsComputed'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    metrics_type: z.string(),
    pnl_stats: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
        mean: z.number().optional(),
        median: z.number().optional(),
      })
      .optional(),
    roi: z.number().optional(),
    max_drawdown: z.number().optional(),
    win_rate: z.number().optional(),
  }),
});

export const ArtifactWrittenEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('ArtifactWritten'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    artifact_type: z.string(),
    artifact_path: z.string(),
    size_bytes: z.number().optional(),
    content_hash: z.string().optional(),
  }),
});

export const RunFailedEventSchema = z.object({
  event_id: z.string().uuid(),
  run_id: z.string().uuid(),
  event_type: z.literal('RunFailed'),
  occurred_at: z.string(),
  event_version: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  payload: z.object({
    error_code: z.string().optional(),
    error_message: z.string(),
    phase: z.string().optional(),
    stack_trace: z.string().optional(),
  }),
});

/**
 * Schema map for event validation
 */
export const EVENT_SCHEMAS: Record<RunEventType, z.ZodSchema> = {
  RunCreated: RunCreatedEventSchema,
  InputsResolved: InputsResolvedEventSchema,
  SliceGenerated: SliceGeneratedEventSchema,
  SimulationStarted: SimulationStartedEventSchema,
  SimulationCompleted: SimulationCompletedEventSchema,
  MetricsComputed: MetricsComputedEventSchema,
  ArtifactWritten: ArtifactWrittenEventSchema,
  RunFailed: RunFailedEventSchema,
};

/**
 * Run state projection (derived from events)
 */
export interface RunState {
  run_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: DateTime;
  started_at?: DateTime;
  completed_at?: DateTime;
  failed_at?: DateTime;
  strategy_id: string;
  strategy_name: string;
  code_version?: string;
  config_hash?: string;
  seed?: number;
  last_event_type?: RunEventType;
  last_event_at?: DateTime;
  error_message?: string;
  error_code?: string;
  // Derived metrics
  calls_attempted?: number;
  calls_succeeded?: number;
  calls_failed?: number;
  trades_total?: number;
}
