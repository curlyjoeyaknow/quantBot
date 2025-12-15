#!/usr/bin/env ts-node

/**
 * CLI script for fetching OHLCV candles for calls
 *
 * Usage:
 *   ts-node scripts/ingest/fetch-ohlcv-for-calls.ts [--from <date>] [--to <date>] [--pre-window-minutes <n>] [--post-window-minutes <n>] [--interval <1m|5m>]
 */

// @ts-expect-error - commander types may not be installed yet
import { program } from 'commander';
import { CallsRepository, TokensRepository } from '@quantbot/storage';
import { OhlcvIngestionService } from '@quantbot/ingestion';
import { logger } from '@quantbot/utils';

// Initialize repositories
const callsRepo = new CallsRepository();
const tokensRepo = new TokensRepository();

// Initialize service
const ingestionService = new OhlcvIngestionService(callsRepo, tokensRepo);

program
  .name('fetch-ohlcv-for-calls')
  .description('Fetch OHLCV candles for calls and store in ClickHouse')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option(
    '--pre-window-minutes <n>',
    'Minutes before call time to fetch (default: 260 for 52x5m)',
    '260'
  )
  .option('--post-window-minutes <n>', 'Minutes after call time to fetch (default: 1440)', '1440')
  .option('--interval <interval>', 'Candle interval (1m or 5m)', '5m')
  .action(async (options) => {
    try {
      const from = options.from ? new Date(options.from) : undefined;
      const to = options.to ? new Date(options.to) : undefined;
      const preWindow = parseInt(options.preWindowMinutes, 10);
      const postWindow = parseInt(options.postWindowMinutes, 10);
      logger.info('Starting OHLCV ingestion', {
        from,
        to,
        preWindowMinutes: preWindow,
        postWindowMinutes: postWindow,
      });

      const result = await ingestionService.ingestForCalls({
        from,
        to,
        preWindowMinutes: preWindow,
        postWindowMinutes: postWindow,
        options: { useCache: true },
      });

      console.log('\n✅ OHLCV ingestion complete!');
      console.log(`   Tokens processed: ${result.tokensProcessed}`);
      console.log(`   Tokens succeeded: ${result.tokensSucceeded}`);
      console.log(`   Tokens failed: ${result.tokensFailed}`);
      console.log(`   Candles fetched 1m: ${result.candlesFetched1m}`);
      console.log(`   Candles fetched 5m: ${result.candlesFetched5m}`);

      process.exit(0);
    } catch (error) {
      logger.error('OHLCV ingestion failed', error as Error);
      console.error('\n❌ OHLCV ingestion failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
