/**
 * @quantbot/cli - Unified CLI Interface
 *
 * Public API exports for the CLI package
 */

export * from './core/command-registry';
export * from './core/argument-parser';
export * from './core/output-formatter';
export * from './core/error-handler';
export * from './core/initialization-manager';
export * from './types';

// Export command registry instance for TUI
export { commandRegistry } from './core/command-registry';
