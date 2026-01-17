#!/usr/bin/env node

/**
 * QuantBot CLI Entry Point
 *
 * Command modules register themselves in commandRegistry when imported (side effects).
 * registerXCommands functions add Commander options and wire them to execute(),
 * which uses handlers from the registry.
 */

import { program } from 'commander';
import { ensureInitialized } from '../core/initialization-manager.js';
import { handleError } from '../core/error-handler.js';
import { logger } from '@quantbot/utils';

// Import command modules for side effects (they register themselves in commandRegistry)
// These imports cause commandRegistry.registerPackage() to be called
import '../commands/observability.js';
import '../commands/storage.js';
import '../commands/ohlcv.js';
import '../commands/ingestion.js';
import '../commands/simulation.js';
import '../commands/simulation-interactive.js';
// import '../commands/monitoring.js'; // Archived
import '../commands/analytics.js';
import '../commands/api-clients.js';
import '../commands/telegram.js';
import '../commands/metadata.js';
import '../commands/calls.js';
import '../commands/research.js';
import '../commands/experiments.js';
import '../commands/slices.js';
import '../commands/lab.js';
import '../commands/backtest.js';
import '../commands/validation.js';
import '../commands/architecture.js';
import '../commands/data.js';
import '../commands/strategy.js';

// Import register functions to add Commander options
import { registerObservabilityCommands } from '../commands/observability.js';
import { registerStorageCommands } from '../commands/storage.js';
import { registerOhlcvCommands } from '../commands/ohlcv.js';
import { registerIngestionCommands } from '../commands/ingestion.js';
import { registerSimulationCommands } from '../commands/simulation.js';
import { registerArtifactCommands } from '../commands/artifacts.js';
import { registerInteractiveSimulationCommand } from '../commands/simulation-interactive.js';
import { registerAnalyticsCommands } from '../commands/analytics.js';
import { registerApiClientsCommands } from '../commands/api-clients.js';
import { registerTelegramCommands } from '../commands/telegram.js';
import { registerMetadataCommands } from '../commands/metadata.js';
import { registerCallsCommands } from '../commands/calls.js';
import { registerResearchCommands } from '../commands/research.js';
import { registerExperimentsCommands } from '../commands/experiments.js';
import { registerSlicesCommands } from '../commands/slices.js';
import { registerLabCommands } from '../commands/lab.js';
import { registerBacktestCommands } from '../commands/backtest.js';
import { registerValidationCommands } from '../commands/validation.js';
import { registerArchitectureCommands } from '../commands/architecture.js';
import { registerDataCommands } from '../commands/data.js';
import { registerStrategyCommands } from '../commands/strategy.js';

// Set up program
program
  .name('quantbot')
  .description('QuantBot CLI - Unified interface for all packages')
  .version('1.0.0');

// Register commands
// These functions add Commander options and wire them to execute(),
// which uses handlers from commandRegistry
registerObservabilityCommands(program);
registerStorageCommands(program);
registerOhlcvCommands(program);
registerIngestionCommands(program);
registerSimulationCommands(program);
registerArtifactCommands(program);
registerInteractiveSimulationCommand(program);
registerAnalyticsCommands(program);
registerApiClientsCommands(program);
registerTelegramCommands(program);
registerMetadataCommands(program);
registerCallsCommands(program);
registerResearchCommands(program);
registerExperimentsCommands(program);
registerSlicesCommands(program);
registerLabCommands(program);
registerBacktestCommands(program);
registerValidationCommands(program);
registerArchitectureCommands(program);
registerDataCommands(program);
registerStrategyCommands(program);

// Global error handler
program.configureOutput({
  writeErr: (str) => {
    process.stderr.write(str);
  },
});

// Main execution
async function main() {
  try {
    // Initialize storage connections
    await ensureInitialized();

    // Parse arguments - this will execute the command handler asynchronously
    // Don't call process.exit() here - let async operations complete naturally
    // The process will exit when the event loop is empty and all async work is done
    await program.parseAsync();
  } catch (error) {
    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Always run main() for CLI entry point
main().catch((error) => {
  logger.error('Unhandled error in CLI', error as Error);
  process.exit(1);
});

export { program };
