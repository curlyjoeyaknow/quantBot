/**
 * Telegram Commands
 */

import type { Command } from 'commander';

/**
 * Register telegram commands
 */
export function registerTelegramCommands(program: Command): void {
  program.command('telegram').description('Telegram message operations');

  // Telegram commands will be added here in the future
}
