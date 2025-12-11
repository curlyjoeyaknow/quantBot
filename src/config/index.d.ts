/**
 * Configuration Management
 * ========================
 * Centralized configuration with validation and type safety.
 */
import 'dotenv/config';
import { EnvConfig } from './schema';
/**
 * Load and validate configuration
 */
export declare function loadConfig(): EnvConfig;
/**
 * Get configuration (loads if not already loaded)
 */
export declare function getConfig(): EnvConfig;
/**
 * Get a specific configuration value
 */
export declare function getConfigValue<K extends keyof EnvConfig>(key: K): EnvConfig[K];
/**
 * Reset configuration (useful for testing)
 */
export declare function resetConfig(): void;
/**
 * Validate a specific configuration key
 */
export declare function validateConfigKey<K extends keyof EnvConfig>(key: K, value: unknown): value is EnvConfig[K];
export declare const getConfigInstance: () => EnvConfig;
//# sourceMappingURL=index.d.ts.map