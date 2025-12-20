/**
 * CLI-TUI Bridge - Execute CLI commands from TUI
 */

import type { CLIExecutionResult } from '../types/index.js';
import { logger } from '@quantbot/utils';
import { commandRegistry, parseArguments } from '@quantbot/cli';
import { CommandContext } from '@quantbot/cli';

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

    // Create command context
    const ctx = new CommandContext();

    // Initialize with timeout to prevent hanging
    const initPromise = ctx.ensureInitialized();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Initialization timeout')), 10000);
    });

    try {
      await Promise.race([initPromise, timeoutPromise]);
    } catch (error) {
      // If initialization fails or times out, continue anyway
      // Some commands may work without full initialization
      logger.warn('Storage initialization failed or timed out, continuing anyway', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Execute command
    const result = await command.handler(parsedArgs, ctx);

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
  _onProgress?: (progress: { current: number; total: number; label?: string }) => void
): Promise<CLIExecutionResult> {
  // For now, just call executeCLICommand
  // Progress tracking will be added when commands support it
  return executeCLICommand(packageName, commandName, args);
}
