/**
 * Configuration loading from environment variables
 *
 * Provides typed configuration objects for database connections,
 * API keys, and other environment-based settings.
 */

import { ConfigurationError } from '../errors.js';

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  maxConnections: number;
}

export interface ClickHouseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface BirdeyeConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface DatabaseConfig {
  postgres: PostgresConfig;
  clickhouse: ClickHouseConfig;
}

/**
 * Load Postgres configuration from environment variables
 */
export function getPostgresConfig(): PostgresConfig {
  const {
    POSTGRES_HOST,
    POSTGRES_PORT,
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_DATABASE,
    POSTGRES_MAX_CONNECTIONS,
  } = process.env;

  return {
    host: POSTGRES_HOST || 'localhost',
    port: POSTGRES_PORT ? Number(POSTGRES_PORT) : 5432,
    user: POSTGRES_USER || 'quantbot',
    password: POSTGRES_PASSWORD || '',
    database: POSTGRES_DATABASE || 'quantbot',
    maxConnections: POSTGRES_MAX_CONNECTIONS ? Number(POSTGRES_MAX_CONNECTIONS) : 10,
  };
}

/**
 * Load ClickHouse configuration from environment variables
 */
export function getClickHouseConfig(): ClickHouseConfig {
  const {
    CLICKHOUSE_HOST,
    CLICKHOUSE_PORT,
    CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD,
    CLICKHOUSE_DATABASE,
  } = process.env;

  return {
    host: CLICKHOUSE_HOST || 'localhost',
    port: CLICKHOUSE_PORT ? Number(CLICKHOUSE_PORT) : 8123,
    user: CLICKHOUSE_USER || 'default',
    password: CLICKHOUSE_PASSWORD || '',
    database: CLICKHOUSE_DATABASE || 'quantbot',
  };
}

/**
 * Load database configuration (Postgres + ClickHouse)
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    postgres: getPostgresConfig(),
    clickhouse: getClickHouseConfig(),
  };
}

/**
 * Load Birdeye API configuration
 */

export function getBirdeyeConfig(): BirdeyeConfig {
  const { BIRDEYE_API_KEY, BIRDEYE_BASE_URL } = process.env;

  if (!BIRDEYE_API_KEY) {
    throw new ConfigurationError(
      'BIRDEYE_API_KEY environment variable is required',
      'BIRDEYE_API_KEY'
    );
  }

  return {
    apiKey: BIRDEYE_API_KEY,
    baseUrl: BIRDEYE_BASE_URL || 'https://public-api.birdeye.so',
  };
}
