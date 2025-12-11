#!/usr/bin/env ts-node

/**
 * CLI script for running simulations on calls
 * 
 * Usage:
 *   ts-node scripts/simulation/run-strategy-on-calls.ts --strategy <name> --caller <name> --from <date> --to <date>
 */

#!/usr/bin/env ts-node

/**
 * CLI script for running simulations on calls
 * 
 * Usage:
 *   ts-node scripts/simulation/run-strategy-on-calls.ts --strategy <name> --caller <name> --from <date> --to <date>
 */

// @ts-ignore - commander types may not be installed yet
import { program } from 'commander';
import {
  StrategiesRepository,
  CallsRepository,
  SimulationRunsRepository,
  SimulationResultsRepository,
  OhlcvRepository,
  SimulationEventsRepository,
} from '@quantbot/storage';
import { SimulationService } from '@quantbot/services';
import { logger } from '@quantbot/utils';

// Initialize service (repositories initialized internally)
const simulationService = new SimulationService();

program
  .name('run-strategy-on-calls')
  .description('Run simulation on a selection of calls')
  .requiredOption('--strategy <name>', 'Strategy name (e.g., PT2_SL25_TS10@1.3)')
  .requiredOption('--caller <name>', 'Caller name (e.g., Brook)')
  .requiredOption('--from <date>', 'Start date (YYYY-MM-DD)')
  .requiredOption('--to <date>', 'End date (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      logger.info('Starting simulation', options);

      const result = await simulationService.runOnCalls({
        strategyName: options.strategy,
        selection: {
          callerNames: [options.caller],
          from: new Date(options.from),
          to: new Date(options.to),
        },
      });

      console.log('\n✅ Simulation complete!');
      console.log(`   Run ID: ${result.runId}`);
      console.log(`   Final PnL: $${result.finalPnl.toFixed(2)}`);
      console.log(`   Win Rate: ${(result.winRate * 100).toFixed(1)}%`);
      console.log(`   Max Drawdown: ${(result.maxDrawdown * 100).toFixed(1)}%`);
      console.log(`   Trade Count: ${result.tradeCount}`);
      console.log(`   Token Count: ${result.tokenCount}`);

      process.exit(0);
    } catch (error) {
      logger.error('Simulation failed', error as Error);
      console.error('\n❌ Simulation failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();

