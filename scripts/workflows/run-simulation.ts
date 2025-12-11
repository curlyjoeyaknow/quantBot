#!/usr/bin/env ts-node
/**
 * Simulation Script - Using Workflow Middleware
 * 
 * This script demonstrates how to use the reusable simulation workflow
 * instead of writing a custom script for each strategy variation.
 * 
 * Usage:
 *   ts-node scripts/workflows/run-simulation.ts --strategy PT2_SL25 --caller Brook --from 2024-01-01
 */

import 'dotenv/config';
import { program } from 'commander';
import { Pool } from 'pg';
import { createSimulationWorkflow } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';
import type { Strategy } from '@quantbot/core';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

// Strategy presets
const STRATEGY_PRESETS: Record<string, Strategy> = {
  PT2_SL25: [
    { percent: 0.5, target: 2.0 },
    { percent: 0.3, target: 3.0 },
    { percent: 0.2, target: 5.0 },
  ],
  PT3_SL20: [
    { percent: 0.4, target: 3.0 },
    { percent: 0.3, target: 5.0 },
    { percent: 0.3, target: 10.0 },
  ],
  SIMPLE_2X: [
    { percent: 1.0, target: 2.0 },
  ],
};

program
  .name('run-simulation')
  .description('Run simulations using reusable workflow middleware')
  .requiredOption('--strategy <name>', 'Strategy name (PT2_SL25, PT3_SL20, SIMPLE_2X, or JSON)')
  .option('--query-type <type>', 'Query type: alerts, calls, custom', 'alerts')
  .option('--caller <names...>', 'Caller names (space-separated)')
  .option('--chain <chains...>', 'Chains (space-separated)', ['solana'])
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--limit <n>', 'Limit number of alerts', '1000')
  .option('--pre-window-minutes <n>', 'Minutes before alert to fetch', '260')
  .option('--post-window-minutes <n>', 'Minutes after alert to fetch', '10080')
  .option('--stop-loss <percent>', 'Stop loss percentage (e.g., 0.2 for 20%)', '0.2')
  .option('--results-table <name>', 'Table to store results', 'simulation_results')
  .option('--rate-limit-ms <n>', 'Rate limit in milliseconds', '100')
  .action(async (options) => {
    try {
      // Parse strategy
      let strategy: Strategy;
      if (STRATEGY_PRESETS[options.strategy]) {
        strategy = STRATEGY_PRESETS[options.strategy];
      } else if (options.strategy.startsWith('[')) {
        // JSON strategy
        strategy = JSON.parse(options.strategy);
      } else {
        throw new Error(`Unknown strategy: ${options.strategy}. Use preset name or JSON array.`);
      }

      logger.info('Starting simulation workflow', {
        strategy: options.strategy,
        queryType: options.queryType,
        caller: options.caller,
      });

      const workflow = createSimulationWorkflow({
        queryType: options.queryType as 'alerts' | 'calls',
        strategy,
        stopLoss: {
          initial: parseFloat(options.stopLoss),
          trailing: 'none',
        },
        entry: {
          initialEntry: 0.0,
          trailingEntry: 'none',
          maxWaitTime: 0,
        },
        costs: {
          entrySlippageBps: 300,
          exitSlippageBps: 300,
          takerFeeBps: 50,
          borrowAprBps: 0,
        },
        callerNames: options.caller,
        chains: options.chain,
        from: options.from ? new Date(options.from) : undefined,
        to: options.to ? new Date(options.to) : undefined,
        limit: parseInt(options.limit, 10),
        preWindowMinutes: parseInt(options.preWindowMinutes, 10),
        postWindowMinutes: parseInt(options.postWindowMinutes, 10),
        rateLimitMs: parseInt(options.rateLimitMs, 10),
        pgPool,
        resultsTable: options.resultsTable,
      });

      const result = await workflow.execute(null);

      console.log('\n✅ Simulation complete!');
      console.log(`   Processed: ${result.metadata.processed}`);
      console.log(`   Success: ${result.metadata.success}`);
      console.log(`   Failed: ${result.metadata.failed}`);

      if (result.metadata.errors.length > 0) {
        console.log(`\n⚠️  Errors (showing first 10):`);
        result.metadata.errors.slice(0, 10).forEach((err, i) => {
          console.log(`   ${i + 1}. ${err.error.substring(0, 80)}`);
        });
      }

      await pgPool.end();
      process.exit(0);
    } catch (error) {
      logger.error('Simulation failed', error as Error);
      console.error('\n❌ Simulation failed:', (error as Error).message);
      await pgPool.end();
      process.exit(1);
    }
  });

program.parse();

