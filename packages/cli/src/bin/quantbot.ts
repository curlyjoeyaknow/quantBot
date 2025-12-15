#!/usr/bin/env node

/**
 * QuantBot CLI Entry Point
 */

import { program } from 'commander';
import { commandRegistry } from '../core/command-registry';
import { ensureInitialized } from '../core/initialization-manager';
import { handleError } from '../core/error-handler';
import { logger } from '@quantbot/utils';

// Import command modules
import { registerObservabilityCommands } from '../commands/observability';
import { registerStorageCommands } from '../commands/storage';
import { registerOhlcvCommands } from '../commands/ohlcv';
import { registerIngestionCommands } from '../commands/ingestion';
import { registerSimulationCommands } from '../commands/simulation';
// import { registerMonitoringCommands } from '../commands/monitoring'; // Archived
import { registerAnalyticsCommands } from '../commands/analytics';
import { registerApiClientsCommands } from '../commands/api-clients';

// Set up program
program
  .name('quantbot')
  .description('QuantBot CLI - Unified interface for all packages')
  .version('1.0.0');

// Register commands
registerObservabilityCommands(program);
registerStorageCommands(program);
registerOhlcvCommands(program);
registerIngestionCommands(program);
registerSimulationCommands(program);
// registerMonitoringCommands(program); // Archived
registerAnalyticsCommands(program);
registerApiClientsCommands(program);

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
  } catch (error) {
    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in CLI', error as Error);
    process.exit(1);
  });
}

export { program };
