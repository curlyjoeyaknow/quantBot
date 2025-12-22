/**
 * Telegram Commands
 */

import type { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { runTelegramTuiFromCli } from './telegram/tui/cliEntrypoint.js';
import { handleError } from '../core/error-handler.js';

/**
 * Find workspace root by walking up from current directory
 */
function findWorkspaceRoot(startDir: string): string {
  let current = path.resolve(startDir);
  const root = path.parse(current).root;

  while (current !== root) {
    const workspaceFile = path.join(current, 'pnpm-workspace.yaml');
    const packageFile = path.join(current, 'package.json');

    if (fs.existsSync(workspaceFile)) {
      return current;
    }

    if (fs.existsSync(packageFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        if (pkg.workspaces || pkg.pnpm?.workspace) {
          return current;
        }
      } catch {
        // Continue searching
      }
    }

    current = path.dirname(current);
  }

  return startDir;
}

/**
 * Register telegram commands
 */
export function registerTelegramCommands(program: Command): void {
  const telegramCmd = program.command('telegram').description('Telegram message operations');

  const workspaceRoot = findWorkspaceRoot(process.cwd());

  // TUI command
  telegramCmd
    .command('tui')
    .description('Interactive TUI for viewing normalized and quarantined Telegram messages')
    .option(
      '-n, --normalized <path>',
      'Path to normalized messages NDJSON file',
      path.join(workspaceRoot, 'data', 'normalized_messages.ndjson')
    )
    .option(
      '-q, --quarantine <path>',
      'Path to quarantine NDJSON file',
      path.join(workspaceRoot, 'data', 'quarantine.ndjson')
    )
    .option('--chat <id>', 'Filter by chat ID (optional)')
    .option('-m, --max <lines>', 'Maximum lines to read from each file', '200000')
    .action(async (options) => {
      try {
        // Convert max to number
        const maxLines = options.max ? parseInt(options.max, 10) : 200000;

        // Build argv array for the CLI entrypoint
        const argv = [
          process.argv[0],
          process.argv[1],
          ...(options.normalized ? ['--normalized', options.normalized] : []),
          ...(options.quarantine ? ['--quarantine', options.quarantine] : []),
          ...(options.chat ? ['--chat', options.chat] : []),
          ...(maxLines ? ['--max', String(maxLines)] : []),
        ];

        await runTelegramTuiFromCli(argv);
      } catch (error) {
        const message = handleError(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
    });
}
