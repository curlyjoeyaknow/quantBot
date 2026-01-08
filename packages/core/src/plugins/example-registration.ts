/**
 * Example Plugin Registration
 *
 * This file demonstrates how to register plugins in composition roots (CLI, API, lab-ui).
 * Copy this pattern to your composition root and register your plugins.
 *
 * Example usage:
 * ```typescript
 * import { registerStrategyPlugin } from '@quantbot/core';
 * import { MyStrategyFactory } from './my-strategy-plugin.js';
 *
 * registerStrategyPlugin(
 *   {
 *     pluginId: 'my-strategy',
 *     name: 'My Custom Strategy',
 *     apiVersion: 1,
 *     version: '1.0.0',
 *     description: 'A custom strategy plugin',
 *   },
 *   new MyStrategyFactory()
 * );
 * ```
 */

import type { StrategyFactory, DataSourceFactory, OutputFactory } from './types.js';

/**
 * Example: Register a strategy plugin
 *
 * In your composition root (CLI, API, lab-ui), import and call this:
 *
 * ```typescript
 * import { registerStrategyPlugin } from '@quantbot/core';
 * import { MyStrategyFactory } from './plugins/my-strategy.js';
 *
 * registerStrategyPlugin(
 *   {
 *     pluginId: 'my-strategy',
 *     name: 'My Strategy',
 *     apiVersion: 1,
 *     version: '1.0.0',
 *     description: 'Custom strategy implementation',
 *   },
 *   new MyStrategyFactory()
 * );
 * ```
 */
export function exampleStrategyPluginRegistration(): void {
  // This is just an example - actual registration happens in composition roots
  // See packages/cli/src/main.ts, packages/api/src/main.ts, etc.
}

/**
 * Example: Register a data source plugin
 */
export function exampleDataSourcePluginRegistration(): void {
  // Example implementation
}

/**
 * Example: Register an output plugin
 */
export function exampleOutputPluginRegistration(): void {
  // Example implementation
}
