/**
 * YAML Configuration Loader
 * ==========================
 * Loads configuration from config.yaml file with fallback to environment variables
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { logger } from '../logger.js';

export interface AppConfig {
  duckdb?: {
    path?: string;
  };
  clickhouse?: {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
  };
  [key: string]: unknown;
}

let cachedConfig: AppConfig | null = null;

/**
 * Load configuration from config.yaml file
 */
export function loadConfigFromYaml(configPath?: string): AppConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const defaultPath = configPath || join(process.cwd(), 'config.yaml');

  if (!existsSync(defaultPath)) {
    logger.debug('config.yaml not found, using environment variables only');
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    const content = readFileSync(defaultPath, 'utf-8');
    const config = load(content) as AppConfig;
    logger.info('Loaded configuration from config.yaml', { path: defaultPath });
    cachedConfig = config;
    return config;
  } catch (error) {
    logger.warn('Failed to load config.yaml, using environment variables only', {
      path: defaultPath,
      error: error instanceof Error ? error.message : String(error),
    });
    cachedConfig = {};
    return cachedConfig;
  }
}

/**
 * Get DuckDB path from config.yaml, environment variable, or default
 */
export function getDuckDBPath(defaultPath: string = 'data/tele.duckdb'): string {
  const config = loadConfigFromYaml();

  // Priority: config.yaml > DUCKDB_PATH env var > default
  if (config.duckdb?.path) {
    return config.duckdb.path;
  }

  if (process.env.DUCKDB_PATH) {
    return process.env.DUCKDB_PATH;
  }

  return defaultPath;
}

/**
 * Clear cached config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
