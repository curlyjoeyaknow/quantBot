/**
 * CLI-TUI Bridge - Execute CLI commands from TUI
 */

import type { CLIExecutionResult } from '../types';
import { logger } from '@quantbot/utils';
import { commandRegistry } from '@quantbot/cli';
import { parseArguments } from '@quantbot/cli';

/**
 * Execute a CLI command programmatically
 */
export async function executeCLICommand(
  packageName: string,
  commandName: string,
  args: Record<string, unknown>
): Promise<CLIExecutionResult> {
  try {
    const command = commandRegistry.getCommand(packageName, commandName);
    if (!command) {
      return {
        success: false,
        error: `Command ${packageName}.${commandName} not found`,
      };
    }

    // Parse and validate arguments
    const parsedArgs = parseArguments(command.schema, args);

    // Execute command
    const result = await command.handler(parsedArgs);

    return {
      success: true,
      data: result,
    };
  } catch (error) {
    logger.error('CLI command execution error', error as Error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute CLI command with progress tracking
 */
export async function executeCLICommandWithProgress(
  packageName: string,
  commandName: string,
  args: Record<string, unknown>,
  onProgress?: (progress: { current: number; total: number; label?: string }) => void
): Promise<CLIExecutionResult> {
  // For now, just call executeCLICommand
  // Progress tracking will be added when commands support it
  return executeCLICommand(packageName, commandName, args);
}
