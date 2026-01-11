/**
 * Run Event Helper Functions
 *
 * Pure functions for creating run events with proper typing and validation.
 */

import { randomUUID } from 'crypto';
import { DateTime } from 'luxon';
import type {
  RunEvent,
  RunCreatedEvent,
  InputsResolvedEvent,
  SliceGeneratedEvent,
  SimulationStartedEvent,
  SimulationCompletedEvent,
  MetricsComputedEvent,
  ArtifactWrittenEvent,
  RunFailedEvent,
} from './RunEvents.js';
import { EVENT_SCHEMA_VERSIONS } from './RunEvents.js';

/**
 * Create a RunCreated event
 */
export function createRunCreatedEvent(
  runId: string,
  payload: RunCreatedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): RunCreatedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'RunCreated',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.RunCreated,
    payload,
    metadata,
  };
}

/**
 * Create an InputsResolved event
 */
export function createInputsResolvedEvent(
  runId: string,
  payload: InputsResolvedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): InputsResolvedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'InputsResolved',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.InputsResolved,
    payload,
    metadata,
  };
}

/**
 * Create a SliceGenerated event
 */
export function createSliceGeneratedEvent(
  runId: string,
  payload: SliceGeneratedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): SliceGeneratedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'SliceGenerated',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.SliceGenerated,
    payload,
    metadata,
  };
}

/**
 * Create a SimulationStarted event
 */
export function createSimulationStartedEvent(
  runId: string,
  payload: SimulationStartedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): SimulationStartedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'SimulationStarted',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.SimulationStarted,
    payload,
    metadata,
  };
}

/**
 * Create a SimulationCompleted event
 */
export function createSimulationCompletedEvent(
  runId: string,
  payload: SimulationCompletedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): SimulationCompletedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'SimulationCompleted',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.SimulationCompleted,
    payload,
    metadata,
  };
}

/**
 * Create a MetricsComputed event
 */
export function createMetricsComputedEvent(
  runId: string,
  payload: MetricsComputedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): MetricsComputedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'MetricsComputed',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.MetricsComputed,
    payload,
    metadata,
  };
}

/**
 * Create an ArtifactWritten event
 */
export function createArtifactWrittenEvent(
  runId: string,
  payload: ArtifactWrittenEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): ArtifactWrittenEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'ArtifactWritten',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.ArtifactWritten,
    payload,
    metadata,
  };
}

/**
 * Create a RunFailed event
 */
export function createRunFailedEvent(
  runId: string,
  payload: RunFailedEvent['payload'],
  occurredAt: DateTime = DateTime.utc(),
  metadata?: Record<string, unknown>
): RunFailedEvent {
  return {
    event_id: randomUUID(),
    run_id: runId,
    event_type: 'RunFailed',
    occurred_at: occurredAt,
    event_version: EVENT_SCHEMA_VERSIONS.RunFailed,
    payload,
    metadata,
  };
}
