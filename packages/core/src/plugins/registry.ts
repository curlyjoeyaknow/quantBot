/**
 * Plugin Registry
 *
 * Central registry for plugins with static registration.
 * Prefer static registration over dynamic require() scanning for determinism and security.
 */

import type {
  PluginMetadata,
  PluginType,
  PluginCapability,
  RegisteredPlugin,
  PluginQuery,
  StrategyFactory,
  DataSourceFactory,
  OutputFactory,
} from './types.js';

/**
 * Plugin registry (singleton)
 */
class PluginRegistryImpl {
  private plugins = new Map<string, RegisteredPlugin>();

  /**
   * Register a plugin
   *
   * @param metadata - Plugin metadata
   * @param capability - Plugin capability (factory)
   * @throws Error if plugin with same ID already exists
   */
  register(metadata: PluginMetadata, capability: PluginCapability): void {
    if (this.plugins.has(metadata.pluginId)) {
      throw new Error(`Plugin with ID '${metadata.pluginId}' is already registered`);
    }

    // Validate capability matches type
    this.validateCapability(metadata.type, capability);

    this.plugins.set(metadata.pluginId, {
      metadata,
      capability,
    });
  }

  /**
   * Get a plugin by ID
   *
   * @param pluginId - Plugin identifier
   * @returns Registered plugin, or undefined if not found
   */
  get(pluginId: string): RegisteredPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Query plugins
   *
   * @param query - Query filter
   * @returns Array of matching plugins
   */
  query(query: PluginQuery = {}): RegisteredPlugin[] {
    const results: RegisteredPlugin[] = [];

    for (const plugin of this.plugins.values()) {
      if (query.type && plugin.metadata.type !== query.type) {
        continue;
      }

      if (query.apiVersion && plugin.metadata.apiVersion !== query.apiVersion) {
        continue;
      }

      if (query.pluginId && plugin.metadata.pluginId !== query.pluginId) {
        continue;
      }

      results.push(plugin);
    }

    return results;
  }

  /**
   * List all registered plugin IDs
   */
  listIds(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Get all plugins of a specific type
   */
  getByType(type: PluginType): RegisteredPlugin[] {
    return this.query({ type });
  }

  /**
   * Check if a plugin is registered
   */
  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Unregister a plugin (for testing)
   */
  unregister(pluginId: string): boolean {
    return this.plugins.delete(pluginId);
  }

  /**
   * Clear all plugins (for testing)
   */
  clear(): void {
    this.plugins.clear();
  }

  /**
   * Validate that capability matches plugin type
   */
  private validateCapability(type: PluginType, capability: PluginCapability): void {
    switch (type) {
      case 'strategy':
        if (!this.isStrategyFactory(capability)) {
          throw new Error('Strategy plugin must provide StrategyFactory');
        }
        break;
      case 'datasource':
        if (!this.isDataSourceFactory(capability)) {
          throw new Error('DataSource plugin must provide DataSourceFactory');
        }
        break;
      case 'output':
        if (!this.isOutputFactory(capability)) {
          throw new Error('Output plugin must provide OutputFactory');
        }
        break;
      default:
        throw new Error(`Unknown plugin type: ${type}`);
    }
  }

  private isStrategyFactory(capability: PluginCapability): capability is StrategyFactory {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      'create' in capability &&
      'validateConfig' in capability &&
      typeof (capability as StrategyFactory).create === 'function' &&
      typeof (capability as StrategyFactory).validateConfig === 'function'
    );
  }

  private isDataSourceFactory(capability: PluginCapability): capability is DataSourceFactory {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      'create' in capability &&
      'validateConfig' in capability &&
      typeof (capability as DataSourceFactory).create === 'function' &&
      typeof (capability as DataSourceFactory).validateConfig === 'function'
    );
  }

  private isOutputFactory(capability: PluginCapability): capability is OutputFactory {
    return (
      typeof capability === 'object' &&
      capability !== null &&
      'create' in capability &&
      'validateConfig' in capability &&
      typeof (capability as OutputFactory).create === 'function' &&
      typeof (capability as OutputFactory).validateConfig === 'function'
    );
  }
}

/**
 * Global plugin registry instance
 */
export const pluginRegistry = new PluginRegistryImpl();

/**
 * Register a strategy plugin
 */
export function registerStrategyPlugin(
  metadata: Omit<PluginMetadata, 'type'> & { type?: 'strategy' },
  factory: StrategyFactory
): void {
  pluginRegistry.register(
    {
      ...metadata,
      type: 'strategy',
    },
    factory
  );
}

/**
 * Register a data source plugin
 */
export function registerDataSourcePlugin(
  metadata: Omit<PluginMetadata, 'type'> & { type?: 'datasource' },
  factory: DataSourceFactory
): void {
  pluginRegistry.register(
    {
      ...metadata,
      type: 'datasource',
    },
    factory
  );
}

/**
 * Register an output plugin
 */
export function registerOutputPlugin(
  metadata: Omit<PluginMetadata, 'type'> & { type?: 'output' },
  factory: OutputFactory
): void {
  pluginRegistry.register(
    {
      ...metadata,
      type: 'output',
    },
    factory
  );
}
