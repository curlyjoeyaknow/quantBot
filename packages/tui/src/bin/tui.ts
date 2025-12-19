#!/usr/bin/env node

/**
 * TUI Entry Point
 */

import { TUIApp } from '../app.js';
import { DashboardScreen } from '../screens/dashboard.js';
import { logger } from '@quantbot/utils';

async function main() {
  try {
    const app = new TUIApp();
    await app.start();

    // Navigate to dashboard
    const dashboard = new DashboardScreen();
    const blessedScreen = app.getBlessedScreen();
    const screenManager = app.getScreenManager();
    
    // Set blessed screen on dashboard
    dashboard.setBlessedScreen(blessedScreen, screenManager);
    
    app.navigateTo(dashboard);

    // Blessed handles input automatically through the screen's key handlers
    // Additional key handling is done in the app and blessed screen

    // Keep process alive
    process.on('SIGINT', () => {
      app.quit();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      app.quit();
      process.exit(0);
    });
  } catch (error) {
    logger.error('Unhandled error in TUI', error as Error);
    process.exit(1);
  }
}

// ES module entry point
main().catch((error) => {
  logger.error('Failed to start TUI', error as Error);
  process.exit(1);
});
