/**
 * Sinks Module Index
 * ==================
 * Exports all result sink implementations.
 *
 * Note: I/O sinks (clickhouse, csv) have been moved to @quantbot/workflows.
 * Only pure sinks (console, json) remain here.
 */

export * from './base';
export * from './console-sink';
export * from './json-sink';
/**
 * @deprecated CSV sink has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/sinks/csv-sink instead.
 */
export * from './csv-sink';
/**
 * @deprecated ClickHouse sink has been moved to @quantbot/workflows.
 * Import from @quantbot/workflows/sinks/clickhouse-sink instead.
 */
export * from './clickhouse-sink';
