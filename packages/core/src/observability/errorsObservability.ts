/**
 * Error Observability Helper
 *
 * Pure utility that converts errors to structured events.
 * Uses ClockPort instead of Date.now() for determinism.
 */

import type { ClockPort } from '../ports/clockPort.js';

export type ErrorEvent = {
  message: string;
  name?: string;
  stack?: string;
  atMs: number;
  tags?: Record<string, string>;
};

/**
 * Convert an error to a structured error event
 *
 * @param err - Error to convert
 * @param clock - Clock port (no Date.now() here)
 * @param tags - Optional tags for the error event
 * @returns Structured error event
 */
export function toErrorEvent(
  err: unknown,
  clock: ClockPort,
  tags?: Record<string, string>
): ErrorEvent {
  const e = err instanceof Error ? err : new Error(String(err));
  return {
    message: e.message,
    name: e.name,
    stack: e.stack,
    atMs: clock.nowMs(),
    tags,
  };
}
