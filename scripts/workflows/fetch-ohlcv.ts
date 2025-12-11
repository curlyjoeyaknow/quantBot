#!/usr/bin/env ts-node
/**
 * OHLCV Fetch Script - Using Workflow Middleware
 * 
 * This script demonstrates how to use the reusable OHLCV fetch workflow
 * instead of writing a custom script for each variation.
 * 
 * Usage:
 *   ts-node scripts/workflows/fetch-ohlcv.ts --query-type alerts --caller Brook --limit 100
 */

import 'dotenv/config';
import { program } from 'commander';
import { Pool } from 'pg';
import { createOhlcvFetchWorkflow } from '@quantbot/workflows';
import { logger } from '@quantbot/utils';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

program
  .name('fetch-ohlcv')
  .description('Fetch OHLCV candles using reusable workflow middleware')
  .option('--query-type <type>', 'Query type: alerts, calls, tokens, custom', 'alerts')
  .option('--caller <names...>', 'Caller names (space-separated)')
  .option('--chain <chains...>', 'Chains (space-separated)', ['solana'])
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--pre-window-minutes <n>', 'Minutes before alert to fetch', '260')
  .option('--post-window-minutes <n>', 'Minutes after alert to fetch', '1440')
  .option('--limit <n>', 'Limit number of tokens', '100')
  .option('--min-alert-count <n>', 'Minimum alert count filter')
  .option('--rate-limit-ms <n>', 'Rate limit in milliseconds', '1000')
  .action(async (options) => {
    try {
      logger.info('Starting OHLCV fetch workflow', options);

      const workflow = createOhlcvFetchWorkflow({
        queryType: options.queryType as 'alerts' | 'calls' | 'tokens',
        callerNames: options.caller,
        chains: options.chain,
        from: options.from ? new Date(options.from) : undefined,
        to: options.to ? new Date(options.to) : undefined,
        preWindowMinutes: parseInt(options.preWindowMinutes, 10),
        postWindowMinutes: parseInt(options.postWindowMinutes, 10),
        limit: parseInt(options.limit, 10),
        minAlertCount: options.minAlertCount ? parseInt(options.minAlertCount, 10) : undefined,
        rateLimitMs: parseInt(options.rateLimitMs, 10),
        pgPool,
      });

      const result = await workflow.execute(null);

      console.log('\n✅ OHLCV fetch complete!');
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
      logger.error('OHLCV fetch failed', error as Error);
      console.error('\n❌ OHLCV fetch failed:', (error as Error).message);
      await pgPool.end();
      process.exit(1);
    }
  });

program.parse();

