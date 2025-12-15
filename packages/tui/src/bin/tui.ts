#!/usr/bin/env node

/**
 * TUI Entry Point
 */

import { TUIApp } from '../app';
import { DashboardScreen } from '../screens/dashboard';
import { logger } from '@quantbot/utils';

async function main() {
  try {
    const app = new TUIApp();
    await app.start();

    // Navigate to dashboard
    const dashboard = new DashboardScreen();
    app.navigateTo(dashboard);

    // Set up input handling (simplified - would use readline in production)
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', async (key: string) => {
      if (key === '\u0003') {
        // Ctrl+C
        app.quit();
        process.exit(0);
      }

      await app.handleInput(key);
    });

    // Keep process alive
    process.on('SIGINT', () => {
      app.quit();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Unhandled error in TUI', error as Error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Failed to start TUI', error as Error);
    process.exit(1);
  });
}
