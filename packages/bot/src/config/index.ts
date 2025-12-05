/**
 * Configuration Management
 * ========================
 * Centralized configuration with validation and type safety.
 */

import 'dotenv/config';
import { envSchema, EnvConfig } from './schema';
import { ConfigurationError } from '../utils/errors';
import { logger } from '@quantbot/utils';

let config: EnvConfig | null = null;

/**
 * Load and validate configuration
 */
export function loadConfig(): EnvConfig {
  if (config) {
    return config;
  }

  try {
    // Parse and validate environment variables
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
      const errors = result.error.issues.map((err) => 
        `${err.path.join('.')}: ${err.message}`
      ).join(', ');
      
      throw new ConfigurationError(
        `Configuration validation failed: ${errors}`,
        undefined,
        { errors: result.error.issues }
      );
    }

    config = result.data;
    
    // Use TELEGRAM_BOT_TOKEN as fallback for BOT_TOKEN if not set
    if (!config.BOT_TOKEN && config.TELEGRAM_BOT_TOKEN) {
      config.BOT_TOKEN = config.TELEGRAM_BOT_TOKEN;
    }

    logger.info('Configuration loaded successfully', {
      nodeEnv: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    });

    return config;
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      `Failed to load configuration: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get configuration (loads if not already loaded)
 */
export function getConfig(): EnvConfig {
  return loadConfig();
}

/**
 * Get a specific configuration value
 */
export function getConfigValue<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
  const cfg = getConfig();
  return cfg[key];
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  config = null;
}

/**
 * Validate a specific configuration key
 */
export function validateConfigKey<K extends keyof EnvConfig>(
  key: K,
  value: unknown
): value is EnvConfig[K] {
  try {
    const schema = envSchema.shape[key];
    if (!schema) {
      return false;
    }
    schema.parse(value);
    return true;
  } catch {
    return false;
  }
}

// Export configuration getter function (lazy load to avoid issues)
export const getConfigInstance = (): EnvConfig => {
  return getConfig();
};

