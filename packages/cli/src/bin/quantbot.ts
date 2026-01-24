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
import { logger } from '@quantbot/infra/utils';

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
import '../commands/server.js';
import '../commands/lab-ui.js';
import '../commands/lake.js';
import '../commands/data/raw.js';
import '../commands/data/canonical.js';

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
import { registerServerCommands } from '../commands/server.js';
import { registerLabUiCommands } from '../commands/lab-ui.js';
import { registerLakeCommands } from '../commands/lake.js';
import { registerRawDataCommands } from '../commands/data/raw.js';
import { registerCanonicalCommands } from '../commands/data/canonical.js';
import { registerFeaturesCommands } from '../commands/features.js';

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
registerServerCommands(program);
registerLabUiCommands(program);
registerLakeCommands(program);
registerRawDataCommands(program);
registerCanonicalCommands(program);
registerFeaturesCommands(program);

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

    // Parse arguments
    program.parse();

    // If we reach here and no command was executed, exit successfully
    // (Commands that execute will call process.exit(0) themselves via execute())
    // This handles the case where --help or --version is used, or no command matches
    if (!process.exitCode) {
      process.exit(0);
    }
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
