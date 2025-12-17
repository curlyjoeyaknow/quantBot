#!/usr/bin/env ts-node

/**
 * CLI script for running simulations on calls
 *
 * Usage:
 *   ts-node scripts/simulation/run-strategy-on-calls.ts --strategy <name> --caller <name> --from <date> --to <date>
 */

import { program } from 'commander';
import { DateTime } from 'luxon';
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';

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

      const ctx = createProductionContext();
      const result = await runSimulation(
        {
          strategyName: options.strategy,
          callerName: options.caller,
          from: DateTime.fromISO(options.from, { zone: 'utc' }),
          to: DateTime.fromISO(options.to, { zone: 'utc' }),
          options: {
            dryRun: false,
            preWindowMinutes: 60,
            postWindowMinutes: 1440,
          },
        },
        ctx
      );

      console.log('\n✅ Simulation complete!');
      console.log(`   Calls found: ${result.totals.callsFound}`);
      console.log(`   Calls attempted: ${result.totals.callsAttempted}`);
      console.log(`   Calls succeeded: ${result.totals.callsSucceeded}`);
      console.log(`   Calls failed: ${result.totals.callsFailed}`);
      if (result.pnl.mean !== undefined) {
        console.log(`   Mean PnL: ${(result.pnl.mean * 100).toFixed(1)}%`);
        console.log(
          `   Median PnL: ${result.pnl.median ? (result.pnl.median * 100).toFixed(1) + '%' : 'N/A'}`
        );
      }

      process.exit(0);
    } catch (error) {
      logger.error('Simulation failed', error as Error);
      console.error('\n❌ Simulation failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
