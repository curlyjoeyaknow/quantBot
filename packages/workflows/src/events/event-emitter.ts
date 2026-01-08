/**
 * Event Emission Helpers for Workflows
 *
 * Provides safe event emission that works with or without RunEventPort.
 * Events are emitted only if the port is available in the context.
 */

import type { RunEventPort, RunEvent } from '@quantbot/core';
import { logger } from '@quantbot/utils';

/**
 * Extended WorkflowContext with optional RunEventPort
 */
export interface WorkflowContextWithEvents {
  events?: RunEventPort;
}

/**
 * Emit an event if RunEventPort is available
 *
 * This is a safe wrapper that:
 * - Checks if events port is available
 * - Emits event if available
 * - Logs warning if event emission fails
 * - Does not throw (failures are logged but don't break workflow)
 */
export async function emitEvent(
  context: WorkflowContextWithEvents,
  event: RunEvent
): Promise<void> {
  if (!context.events) {
    // Event port not available - this is OK (backward compatibility)
    return;
  }

  try {
    await context.events.append(event);
  } catch (error) {
    // Log but don't throw - event emission failure shouldn't break workflow
    logger.warn('Failed to emit event', {
      run_id: event.run_id,
      event_type: event.event_type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Emit multiple events atomically if RunEventPort is available
 */
export async function emitEvents(
  context: WorkflowContextWithEvents,
  events: RunEvent[]
): Promise<void> {
  if (!context.events || events.length === 0) {
    return;
  }

  try {
    await context.events.appendMany(events);
  } catch (error) {
    logger.warn('Failed to emit events', {
      run_id: events[0]?.run_id,
      count: events.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
