/**
 * Distributed Tracing
 * ===================
 * Simple span-based distributed tracing for request flows.
 */

import { logger } from '@quantbot/infra/utils';

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  service: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  tags?: Record<string, string | number | boolean>;
  logs?: Array<{ timestamp: number; message: string; fields?: Record<string, unknown> }>;
  error?: {
    message: string;
    stack?: string;
  };
}

export interface TraceContext {
  traceId: string;
  spanId: string;
}

/**
 * In-memory span storage (for development/testing)
 * In production, spans should be exported to a tracing backend (Jaeger, Zipkin, etc.)
 */
class TraceStorage {
  private spans: Map<string, Span> = new Map();
  private traces: Map<string, Span[]> = new Map();

  addSpan(span: Span): void {
    this.spans.set(span.spanId, span);

    const traceSpans = this.traces.get(span.traceId) || [];
    traceSpans.push(span);
    this.traces.set(span.traceId, traceSpans);
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  getTrace(traceId: string): Span[] {
    return this.traces.get(traceId) || [];
  }

  clear(): void {
    this.spans.clear();
    this.traces.clear();
  }
}

const storage = new TraceStorage();

/**
 * Tracer for creating and managing spans
 */
export class Tracer {
  private traceId: string;
  private currentSpanId?: string;

  constructor(traceId?: string, parentSpanId?: string) {
    this.traceId = traceId || generateId();
    this.currentSpanId = parentSpanId;
  }

  /**
   * Start a new span
   */
  startSpan(
    operation: string,
    service: string,
    tags?: Record<string, string | number | boolean>
  ): Span {
    const spanId = generateId();
    const span: Span = {
      traceId: this.traceId,
      spanId,
      parentSpanId: this.currentSpanId,
      operation,
      service,
      startTime: Date.now(),
      tags,
      logs: [],
    };

    this.currentSpanId = spanId;
    storage.addSpan(span);

    return span;
  }

  /**
   * End a span
   */
  endSpan(spanId: string, error?: Error): void {
    const span = storage.getSpan(spanId);
    if (!span) {
      logger.warn('Span not found', { spanId });
      return;
    }

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;

    if (error) {
      span.error = {
        message: error.message,
        stack: error.stack,
      };
    }

    // Export span (in production, send to tracing backend)
    this.exportSpan(span);
  }

  /**
   * Add log to span
   */
  log(spanId: string, message: string, fields?: Record<string, unknown>): void {
    const span = storage.getSpan(spanId);
    if (!span) {
      logger.warn('Span not found for log', { spanId });
      return;
    }

    if (!span.logs) {
      span.logs = [];
    }

    span.logs.push({
      timestamp: Date.now(),
      message,
      fields,
    });
  }

  /**
   * Export span to tracing backend (stub for now)
   */
  private exportSpan(span: Span): void {
    // In production, send to Jaeger, Zipkin, or other tracing backend
    // For now, just log
    if (span.error) {
      logger.error('Span completed with error', {
        traceId: span.traceId,
        spanId: span.spanId,
        operation: span.operation,
        service: span.service,
        duration: span.duration,
        error: span.error,
      });
    } else {
      logger.debug('Span completed', {
        traceId: span.traceId,
        spanId: span.spanId,
        operation: span.operation,
        service: span.service,
        duration: span.duration,
      });
    }
  }

  /**
   * Get trace context for propagation
   */
  getTraceContext(): TraceContext {
    return {
      traceId: this.traceId,
      spanId: this.currentSpanId || generateId(),
    };
  }

  /**
   * Get all spans for this trace
   */
  getTrace(): Span[] {
    return storage.getTrace(this.traceId);
  }
}

/**
 * Create a new tracer
 */
export function createTracer(traceId?: string, parentSpanId?: string): Tracer {
  return new Tracer(traceId, parentSpanId);
}

/**
 * Get trace by ID
 */
export function getTrace(traceId: string): Span[] {
  return storage.getTrace(traceId);
}

/**
 * Clear trace storage (for testing)
 */
export function clearTraces(): void {
  storage.clear();
}
