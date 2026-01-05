/**
 * Sinks Module Index
 * ==================
 * Exports all result sink implementations.
 *
 * Note: I/O sinks (clickhouse, csv) have been moved to @quantbot/workflows.
 * Only pure sinks (console, json) remain here.
 */

export * from './base.js';
export * from './console-sink.js';
export * from './json-sink.js';
// CSV and ClickHouse sinks have been moved to @quantbot/workflows.
// Import from @quantbot/workflows/sinks instead.
