import type { TelemetryPort, EventEmission, MetricEmission } from '@quantbot/core';

export function createTelemetryConsoleAdapter(opts?: {
  prefix?: string;
}): TelemetryPort {
  const prefix = opts?.prefix ?? 'telemetry';

  return {
    emitMetric(metric: MetricEmission) {
      // Structured; still just console for now.
      // NOTE: allowed here (adapter/composition layer), not in core handlers.
      console.log(
        JSON.stringify(
          {
            type: 'metric',
            prefix,
            name: metric.name,
            value: metric.value,
            metricType: metric.type,
            labels: metric.labels,
            timestamp: metric.timestamp,
          },
          null,
          0
        )
      );
    },

    emitEvent(event: EventEmission) {
      console.log(
        JSON.stringify(
          {
            type: 'event',
            prefix,
            name: event.name,
            level: event.level,
            message: event.message,
            context: event.context,
            timestamp: event.timestamp,
            error: event.error,
          },
          null,
          0
        )
      );
    },

    startSpan(name: string, operation: string): import('@quantbot/core').SpanEmission {
      const now = Date.now();
      return {
        name,
        operation,
        startTime: now,
        status: 'ok',
      };
    },

    endSpan(span: import('@quantbot/core').SpanEmission): void {
      const endTime = Date.now();
      const durationMs = endTime - (span.startTime ?? endTime);
      span.endTime = endTime;
      span.durationMs = durationMs;
      this.emitSpan(span);
    },

    emitSpan(span: import('@quantbot/core').SpanEmission): void {
      console.log(
        JSON.stringify(
          {
            type: 'span',
            prefix,
            name: span.name,
            operation: span.operation,
            startTime: span.startTime,
            endTime: span.endTime,
            durationMs: span.durationMs,
            status: span.status,
            attributes: span.attributes,
            events: span.events,
          },
          null,
          0
        )
      );
    },
  };
}

