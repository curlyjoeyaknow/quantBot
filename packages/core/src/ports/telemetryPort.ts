/**
 * Telemetry Port
 *
 * Port interface for structured metrics and events.
 * Handlers emit structured telemetry instead of using console.log or logger directly.
 * Adapters implement this port to provide telemetry capabilities (console, logger, metrics systems, etc.).
 */

/**
 * Metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

/**
 * Metric emission
 */
export type MetricEmission = {
  name: string;
  type: MetricType;
  value: number;
  labels?: Record<string, string>; // Key-value labels for metric dimensions
  timestamp?: number; // Optional timestamp (milliseconds since epoch)
};

/**
 * Event emission
 */
export type EventEmission = {
  name: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>; // Additional context data
  timestamp?: number; // Optional timestamp (milliseconds since epoch)
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
};

/**
 * Span (for distributed tracing)
 */
export type SpanEmission = {
  name: string;
  operation: string;
  startTime: number; // Milliseconds since epoch
  endTime?: number; // Milliseconds since epoch (if completed)
  durationMs?: number; // Duration in milliseconds
  status: 'ok' | 'error' | 'cancelled';
  attributes?: Record<string, string | number | boolean>; // Span attributes
  events?: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, unknown>;
  }>;
};

/**
 * Telemetry Port Interface
 *
 * Handlers emit structured telemetry via this port instead of using console.log or logger directly.
 * Adapters (in packages/observability) implement this port.
 */
export interface TelemetryPort {
  /**
   * Emit a metric
   */
  emitMetric(metric: MetricEmission): void;

  /**
   * Emit an event (structured log)
   */
  emitEvent(event: EventEmission): void;

  /**
   * Start a span (for distributed tracing)
   */
  startSpan(name: string, operation: string): SpanEmission;

  /**
   * End a span
   */
  endSpan(span: SpanEmission): void;

  /**
   * Emit a span (complete span emission)
   */
  emitSpan(span: SpanEmission): void;
}

