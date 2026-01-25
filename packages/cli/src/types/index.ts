/**
 * CLI-specific type definitions
 */

import type { z } from 'zod';
import type { CommandContext } from '../core/command-context.js';

/**
 * Command definition structure
 */
export interface CommandDefinition {
  /**
   * Command name (e.g., 'query', 'run')
   */
  name: string;

  /**
   * Command description for help text
   */
  description: string;

  /**
   * Zod schema for argument validation
   */
  schema: z.ZodSchema;

  /**
   * Command handler function
   * Note: Handlers can be typed more specifically, but the interface accepts unknown for flexibility.
   * The handler will receive validated args matching the schema and a command context.
   */
  handler: (args: unknown, ctx: CommandContext) => Promise<unknown> | unknown;
  // Note: Handlers are typically typed as (args: T, ctx: CommandContext) => Promise<R>
  // but the interface uses unknown to allow flexible typing at registration time

  /**
   * Optional examples for help text
   */
  examples?: string[];
}

/**
 * Package command module structure
 */
export interface PackageCommandModule {
  /**
   * Package name (e.g., 'ohlcv', 'simulation')
   */
  packageName: string;

  /**
   * Package description
   */
  description: string;

  /**
   * Commands in this package
   */
  commands: CommandDefinition[];
}

/**
 * Output format options
 */
export type OutputFormat = 'json' | 'table' | 'csv';

/**
 * Command execution result
 */
export interface CommandResult<T = unknown> {
  /**
   * Success flag
   */
  success: boolean;

  /**
   * Result data
   */
  data?: T;

  /**
   * Error message (if failed)
   */
  error?: string;

  /**
   * Execution metadata
   */
  metadata?: {
    executionTime?: number;
    recordsAffected?: number;
  };
}
