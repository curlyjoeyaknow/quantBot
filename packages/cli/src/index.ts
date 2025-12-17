/**
 * @quantbot/cli - Unified CLI Interface
 *
 * Public API exports for the CLI package
 */

export * from './core/command-registry.js';
export * from './core/argument-parser.js';
export * from './core/output-formatter.js';
export * from './core/error-handler.js';
export * from './core/initialization-manager.js';
export * from './core/command-context.js';
export * from './types/index.js';

// Export command registry instance for TUI
export { commandRegistry } from './core/command-registry.js';
