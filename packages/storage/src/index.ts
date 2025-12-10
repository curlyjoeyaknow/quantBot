/**
 * @quantbot/storage - Storage layer package
 * 
 * Public API exports for the storage package
 * 
 * Golden Path: This package provides typed repositories for:
 * - Postgres (callers, tokens, alerts, calls, strategies, simulation runs)
 * - ClickHouse (OHLCV candles, simulation events)
 */

// Clients
export * from './clickhouse-client';
export * from './postgres-client';
export * from './influxdb-client';

// Legacy exports (will be replaced by repositories)
export * from './caller-database';
export * from './repository';
export * from './cache/ohlcv-cache';

// Package logger
export { logger } from './logger';

// Postgres repositories
export * from './postgres/repositories';

// ClickHouse repositories
export * from './clickhouse/repositories';
