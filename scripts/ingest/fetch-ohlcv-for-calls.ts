#!/usr/bin/env ts-node

/**
 * CLI script for fetching OHLCV candles for calls
 * Uses the ingestOhlcv workflow instead of calling services directly
 *
 * Usage:
 *   ts-node scripts/ingest/fetch-ohlcv-for-calls.ts [--from <date>] [--to <date>] [--pre-window-minutes <n>] [--post-window-minutes <n>] [--interval <1m|5m>] [--duckdb <path>]
 */

import { program } from 'commander';
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import { OhlcvBirdeyeFetch } from '@quantbot/jobs';
import { logger } from '@quantbot/utils';

program
  .name('fetch-ohlcv-for-calls')
  .description('Fetch OHLCV candles for calls and store in ClickHouse (uses workflow)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option(
    '--pre-window-minutes <n>',
    'Minutes before call time to fetch (default: 260 for 52x5m)',
    '260'
  )
  .option('--post-window-minutes <n>', 'Minutes after call time to fetch (default: 1440)', '1440')
  .option('--interval <interval>', 'Candle interval (15s, 1m, 5m, 1H)', '1m')
  .option('--duckdb <path>', 'Path to DuckDB database (or set DUCKDB_PATH env var)')
  .action(async (options) => {
    try {
      const duckdbPath = options.duckdb || process.env.DUCKDB_PATH;
      if (!duckdbPath) {
        console.error('❌ DuckDB path is required. Provide --duckdb or set DUCKDB_PATH env var.');
        process.exit(1);
      }

      logger.info('Starting OHLCV ingestion workflow', {
        duckdbPath,
        from: options.from,
        to: options.to,
        preWindowMinutes: parseInt(options.preWindowMinutes, 10),
        postWindowMinutes: parseInt(options.postWindowMinutes, 10),
        interval: options.interval,
      });

      // Create workflow context with OHLCV Birdeye fetch service
      const workflowContext = createOhlcvIngestionContext({
        ohlcvBirdeyeFetch: new OhlcvBirdeyeFetch({
          rateLimitMs: 100,
          maxRetries: 3,
          checkCoverage: true,
        }),
      });

      // Call workflow
      const result = await ingestOhlcv(
        {
          duckdbPath,
          from: options.from,
          to: options.to,
          side: 'buy',
          chain: 'solana',
          interval: options.interval as '15s' | '1m' | '5m' | '1H',
          preWindowMinutes: parseInt(options.preWindowMinutes, 10),
          postWindowMinutes: parseInt(options.postWindowMinutes, 10),
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        workflowContext
      );

      console.log('\n✅ OHLCV ingestion complete!');
      console.log(`   Worklist generated: ${result.worklistGenerated}`);
      console.log(`   Work items processed: ${result.workItemsProcessed}`);
      console.log(`   Work items succeeded: ${result.workItemsSucceeded}`);
      console.log(`   Work items failed: ${result.workItemsFailed}`);
      console.log(`   Total candles fetched: ${result.totalCandlesFetched}`);
      console.log(`   Total candles stored: ${result.totalCandlesStored}`);

      if (result.errors.length > 0) {
        console.log(`\n⚠️  Errors: ${result.errors.length}`);
        result.errors.slice(0, 5).forEach((error) => {
          console.log(`   ${error.mint}...: ${error.error}`);
        });
        if (result.errors.length > 5) {
          console.log(`   ... and ${result.errors.length - 5} more`);
        }
      }

      process.exit(0);
    } catch (error) {
      logger.error('OHLCV ingestion failed', error as Error);
      console.error('\n❌ OHLCV ingestion failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
