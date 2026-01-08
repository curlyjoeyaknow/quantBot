/**
 * Run Event Port Interface
 *
 * Port for append-only event storage and retrieval.
 * Handlers depend on this port, not on specific storage implementations.
 */

import type { RunEvent, RunState, RunEventType } from '../domain/runs/RunEvents.js';
import { DateTime } from 'luxon';

/**
 * Query filter for events
 */
export interface RunEventQuery {
  run_id?: string;
  event_type?: RunEventType | RunEventType[];
  from_occurred_at?: DateTime;
  to_occurred_at?: DateTime;
  limit?: number;
  offset?: number;
}

/**
 * Event query result
 */
export interface RunEventQueryResult {
  events: RunEvent[];
  total: number;
}

/**
 * Run Event Port
 *
 * Provides append-only event storage and state projection.
 */
export interface RunEventPort {
  /**
   * Append an event to the stream
   *
   * Events are immutable and append-only. Same event_id cannot be appended twice.
   */
  append(event: RunEvent): Promise<void>;

  /**
   * Append multiple events atomically
   *
   * All events must succeed or none are written.
   */
  appendMany(events: RunEvent[]): Promise<void>;

  /**
   * Query events by filter
   *
   * Returns events in chronological order (oldest first).
   */
  query(filter: RunEventQuery): Promise<RunEventQueryResult>;

  /**
   * Get all events for a run
   *
   * Returns events in chronological order.
   */
  getByRunId(runId: string): Promise<RunEvent[]>;

  /**
   * Get run state projection
   *
   * State is derived from events. May be materialized or computed on-demand.
   */
  getRunState(runId: string): Promise<RunState | null>;

  /**
   * Get latest event for a run
   *
   * Returns the most recent event, or null if no events exist.
   */
  getLatestEvent(runId: string): Promise<RunEvent | null>;

  /**
   * Check if port is available
   *
   * @returns true if storage is available and ready
   */
  isAvailable(): Promise<boolean>;
}
