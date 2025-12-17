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
// CSV and ClickHouse sinks have been moved to @quantbot/workflows.
// Import from @quantbot/workflows/sinks instead.
