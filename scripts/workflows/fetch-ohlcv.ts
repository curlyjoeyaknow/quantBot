#!/usr/bin/env ts-node
/**
 * OHLCV Fetch Script
 *
 * Fetches OHLCV candles for tokens from alerts or calls and stores them in ClickHouse.
 *
 * Usage:
 *   ts-node scripts/workflows/fetch-ohlcv.ts --query-type alerts --caller Brook --limit 100
 */

import 'dotenv/config';
import { program } from 'commander';
import { Pool } from 'pg';
import { fetchHybridCandles } from '@quantbot/ohlcv';
import { insertCandles } from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import { DateTime } from 'luxon';
import type { Chain } from '@quantbot/core';

const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'quantbot',
  password: process.env.POSTGRES_PASSWORD || '',
  database: process.env.POSTGRES_DATABASE || 'quantbot',
});

program
  .name('fetch-ohlcv')
  .description('Fetch OHLCV candles for tokens from alerts or calls')
  .option('--query-type <type>', 'Query type: alerts, calls', 'alerts')
  .option('--caller <names...>', 'Caller names (space-separated)')
  .option('--chain <chains...>', 'Chains (space-separated)', ['solana'])
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('--pre-window-minutes <n>', 'Minutes before alert to fetch', '260')
  .option('--post-window-minutes <n>', 'Minutes after alert to fetch', '1440')
  .option('--limit <n>', 'Limit number of tokens', '100')
  .option('--min-alert-count <n>', 'Minimum alert count filter')
  .option('--rate-limit-ms <n>', 'Rate limit in milliseconds', '1000')
  .option('--interval <interval>', 'Candle interval', '5m')
  .action(async (options) => {
    try {
      logger.info('Starting OHLCV fetch', options);

      // Build query based on queryType
      let query = '';
      const queryParams: any[] = [];
      let paramIndex = 1;

      if (options.queryType === 'alerts') {
        const conditions: string[] = [];
        conditions.push('a.alert_price IS NOT NULL');
        conditions.push('a.alert_price > 0');

        if (options.chain) {
          conditions.push(`t.chain = ANY($${paramIndex})`);
          queryParams.push(options.chain);
          paramIndex++;
        }

        if (options.from) {
          conditions.push(`a.alert_timestamp >= $${paramIndex}`);
          queryParams.push(options.from);
          paramIndex++;
        }

        if (options.caller) {
          conditions.push(`c.handle = ANY($${paramIndex})`);
          queryParams.push(options.caller);
          paramIndex++;
        }

        query = `
          SELECT DISTINCT 
            t.address,
            t.symbol,
            t.chain,
            MIN(a.alert_timestamp) as first_alert,
            MAX(a.alert_timestamp) as last_alert,
            COUNT(*) as alert_count
          FROM tokens t
          JOIN alerts a ON a.token_id = t.id
          LEFT JOIN callers c ON c.id = a.caller_id
          WHERE ${conditions.join(' AND ')}
          GROUP BY t.address, t.symbol, t.chain
          ${options.minAlertCount ? `HAVING COUNT(*) >= ${parseInt(options.minAlertCount, 10)}` : ''}
          ORDER BY alert_count DESC
          ${options.limit ? `LIMIT ${parseInt(options.limit, 10)}` : ''}
        `;
      } else if (options.queryType === 'calls') {
        const conditions: string[] = [];

        if (options.from) {
          conditions.push(`c.signal_timestamp >= $${paramIndex}`);
          queryParams.push(options.from);
          paramIndex++;
        }

        if (options.caller) {
          conditions.push(`caller.handle = ANY($${paramIndex})`);
          queryParams.push(options.caller);
          paramIndex++;
        }

        query = `
          SELECT DISTINCT
            t.address,
            t.symbol,
            t.chain,
            MIN(c.signal_timestamp) as first_call,
            MAX(c.signal_timestamp) as last_call,
            COUNT(*) as call_count
          FROM tokens t
          JOIN calls c ON c.token_id = t.id
          LEFT JOIN callers caller ON caller.id = c.caller_id
          ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
          GROUP BY t.address, t.symbol, t.chain
          ORDER BY call_count DESC
          ${options.limit ? `LIMIT ${parseInt(options.limit, 10)}` : ''}
        `;
      } else {
        throw new Error(`Invalid queryType: ${options.queryType}. Use 'alerts' or 'calls'`);
      }

      // Query tokens
      const result = await pgPool.query(query, queryParams);
      const tokens = result.rows;

      logger.info(`Found ${tokens.length} tokens to process`);

      // Process each token
      let processed = 0;
      let success = 0;
      let failed = 0;
      const errors: Array<{ token: string; error: string }> = [];

      const preWindow = parseInt(options.preWindowMinutes, 10) || 260;
      const postWindow = parseInt(options.postWindowMinutes, 10) || 1440;
      const rateLimitMs = parseInt(options.rateLimitMs, 10) || 1000;
      const interval = options.interval || '5m';

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        processed++;

        try {
          const alertTime = DateTime.fromJSDate(new Date(token.first_alert || token.first_call));
          const startTime = alertTime.minus({ minutes: preWindow });
          const endTime = alertTime.plus({ minutes: postWindow });

          logger.debug(`Fetching OHLCV for ${token.symbol || token.address.substring(0, 8)}`, {
            index: i + 1,
            total: tokens.length,
            startTime: startTime.toISO(),
            endTime: endTime.toISO(),
          });

          const candles = await fetchHybridCandles(
            token.address,
            startTime,
            endTime,
            token.chain || 'solana',
            alertTime
          );

          if (candles.length > 0) {
            await insertCandles(token.address, token.chain || 'solana', candles, interval);
            logger.debug(`Stored ${candles.length} candles for ${token.address.substring(0, 8)}`);
            success++;
          } else {
            logger.debug(`No candles to store for ${token.address.substring(0, 8)}`);
            success++; // Not an error, just no data
          }

          // Rate limiting
          if (i < tokens.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
          }
        } catch (error) {
          failed++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          errors.push({
            token: token.address.substring(0, 20),
            error: errorMsg,
          });
          logger.error(`Failed to process token ${token.address.substring(0, 8)}`, error as Error);
        }

        // Progress update every 10 items
        if ((i + 1) % 10 === 0) {
          logger.info(`Progress: ${i + 1}/${tokens.length} tokens processed`);
        }
      }

      console.log('\n✅ OHLCV fetch complete!');
      console.log(`   Processed: ${processed}`);
      console.log(`   Success: ${success}`);
      console.log(`   Failed: ${failed}`);

      if (errors.length > 0) {
        console.log(`\n⚠️  Errors (showing first 10):`);
        errors.slice(0, 10).forEach((err, i) => {
          console.log(`   ${i + 1}. ${err.token}: ${err.error.substring(0, 80)}`);
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
