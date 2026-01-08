/**
 * Plugin Registration for CLI
 *
 * Register plugins in the CLI composition root.
 * This file is imported in the CLI main entry point.
 */

import {
  registerStrategyPlugin,
  registerDataSourcePlugin,
  registerOutputPlugin,
  type StrategyFactory,
  type DataSourceFactory,
  type OutputFactory,
} from '@quantbot/core';

/**
 * Register all plugins for CLI
 *
 * Call this function in the CLI main entry point (packages/cli/src/bin/quantbot.ts)
 */
export function registerCLIPlugins(): void {
  // Example: Register a strategy plugin
  // Uncomment and implement when you have a plugin to register:
  /*
  registerStrategyPlugin(
    {
      pluginId: 'example-strategy',
      name: 'Example Strategy Plugin',
      apiVersion: 1,
      version: '1.0.0',
      description: 'An example strategy plugin',
    },
    {
      create: (config: unknown) => {
        // Create strategy instance from config
        return {
          // Strategy implementation
        };
      },
      validateConfig: (config: unknown) => {
        // Validate config against plugin's schema
        return { valid: true };
      },
    } as StrategyFactory
  );
  */
  // Example: Register a data source plugin
  /*
  registerDataSourcePlugin(
    {
      pluginId: 'example-datasource',
      name: 'Example Data Source Plugin',
      apiVersion: 1,
      version: '1.0.0',
      description: 'An example data source plugin',
    },
    {
      create: (config: unknown) => {
        // Create data source adapter from config
        return {
          // Data source implementation
        };
      },
      validateConfig: (config: unknown) => {
        return { valid: true };
      },
    } as DataSourceFactory
  );
  */
  // Example: Register an output plugin
  /*
  registerOutputPlugin(
    {
      pluginId: 'example-output',
      name: 'Example Output Plugin',
      apiVersion: 1,
      version: '1.0.0',
      description: 'An example output formatter plugin',
    },
    {
      create: (config: unknown) => {
        // Create output formatter from config
        return {
          // Output formatter implementation
        };
      },
      validateConfig: (config: unknown) => {
        return { valid: true };
      },
    } as OutputFactory
  );
  */
  // TODO: Register actual plugins here when they are implemented
}
