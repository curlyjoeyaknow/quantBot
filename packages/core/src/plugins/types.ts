/**
 * Plugin System Domain Types
 *
 * Plugin system for extensibility (strategies, data sources, output).
 * Starts with internal plugins (in-repo), can graduate to external plugins later.
 */

import { z } from 'zod';

/**
 * Plugin API version
 * Increment when plugin interfaces change
 */
export type PluginApiVersion = number;

/**
 * Plugin type discriminator
 */
export type PluginType = 'strategy' | 'datasource' | 'output';

/**
 * Plugin metadata
 */
export interface PluginMetadata {
  /**
   * Unique plugin identifier
   */
  pluginId: string;

  /**
   * Plugin name (human-readable)
   */
  name: string;

  /**
   * Plugin type
   */
  type: PluginType;

  /**
   * API version this plugin implements
   */
  apiVersion: PluginApiVersion;

  /**
   * Plugin version (semver)
   */
  version: string;

  /**
   * Plugin description
   */
  description?: string;

  /**
   * Author information
   */
  author?: string;

  /**
   * Plugin configuration schema (Zod schema as JSON)
   */
  configSchema?: unknown;

  /**
   * Free-form metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Strategy plugin factory
 * Creates strategy instances from configuration
 */
export interface StrategyFactory {
  /**
   * Create a strategy from configuration
   *
   * @param config - Strategy configuration (validated against plugin's configSchema)
   * @returns Strategy instance (opaque to plugin system)
   */
  create(config: unknown): unknown;

  /**
   * Validate configuration against plugin's schema
   *
   * @param config - Configuration to validate
   * @returns Validation result
   */
  validateConfig(config: unknown): { valid: boolean; error?: string };
}

/**
 * Data source plugin factory
 * Creates data source adapters
 */
export interface DataSourceFactory {
  /**
   * Create a data source adapter from configuration
   *
   * @param config - Data source configuration
   * @returns Data source adapter instance
   */
  create(config: unknown): unknown;

  /**
   * Validate configuration
   */
  validateConfig(config: unknown): { valid: boolean; error?: string };
}

/**
 * Output plugin factory
 * Creates output formatters/reporters
 */
export interface OutputFactory {
  /**
   * Create an output formatter from configuration
   *
   * @param config - Output configuration
   * @returns Output formatter instance
   */
  create(config: unknown): unknown;

  /**
   * Validate configuration
   */
  validateConfig(config: unknown): { valid: boolean; error?: string };
}

/**
 * Plugin capability (union of all factory types)
 */
export type PluginCapability = StrategyFactory | DataSourceFactory | OutputFactory;

/**
 * Registered plugin
 */
export interface RegisteredPlugin {
  metadata: PluginMetadata;
  capability: PluginCapability;
}

/**
 * Plugin registry query filter
 */
export interface PluginQuery {
  type?: PluginType;
  apiVersion?: PluginApiVersion;
  pluginId?: string;
}
