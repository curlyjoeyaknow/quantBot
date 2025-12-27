// Import LogHub types - using relative path since @quantbot/lab may not be a dependency
// Type-only import to avoid runtime dependency
type LogHub = {
  emit: (event: {
    level: 'debug' | 'info' | 'warn' | 'error';
    scope: string;
    msg: string;
    ctx?: Record<string, unknown>;
    requestId?: string;
    runId?: string;
    ts?: string;
  }) => void;
};

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
import type { WorkflowContext } from '../types.js';

/**
 * Creates a logger adapter that emits filtered events to LogHub instead of verbose console logs.
 *
 * Only emits important events (info/warn/error), filters out debug-level logs.
 * Uses structured scopes like 'simulation', 'ingestion', 'workflow'.
 */
export function createLogHubLoggerAdapter(
  logHub: LogHub,
  scope: string,
  runId?: string,
  requestId?: string
): WorkflowContext['logger'] {
  const emit = (level: LogLevel, msg: string, ctx?: unknown) => {
    // Filter: only emit info, warn, error (skip debug)
    if (level === 'debug') {
      return; // Skip debug logs - too verbose
    }

    // Extract context as record
    const context = ctx
      ? typeof ctx === 'object' && ctx !== null && !Array.isArray(ctx)
        ? (ctx as Record<string, unknown>)
        : { data: ctx }
      : undefined;

    logHub.emit({
      level,
      scope,
      msg,
      ctx: context,
      requestId,
      runId,
    });
  };

  return {
    info: (message: string, context?: unknown) => {
      emit('info', message, context);
    },
    warn: (message: string, context?: unknown) => {
      emit('warn', message, context);
    },
    error: (message: string, context?: unknown) => {
      emit('error', message, context);
    },
    // Debug logs are filtered out (not emitted to LogHub)
    debug: () => {
      // No-op: debug logs are too verbose for event-based logging
    },
  };
}
