/**
 * Check if ClickHouse has data for tokens in unified_calls
 */

import { Database } from 'sqlite3';
import { promisify } from 'util';
import { DateTime } from 'luxon';
import { config } from 'dotenv';
import { queryCandles } from '../../src/storage/clickhouse-client';
import { logger } from '../../src/utils/logger';
import { UNIFIED_DB_PATH } from './create-unified-calls-table';

config();

async function checkClickHouseData(): Promise<void> {
  const db = new Database(UNIFIED_DB_PATH);
  const all = promisify(db.all.bind(db));
  const close = promisify(db.close.bind(db));

  try {
    // Get sample of valid tokens
    const rows = await all(`
      SELECT DISTINCT token_address, chain, MIN(call_timestamp) as first_call
      FROM unified_calls 
      WHERE call_timestamp > 1577836800 AND call_timestamp < 2000000000
      GROUP BY token_address, chain
      ORDER BY first_call DESC
      LIMIT 20
    `) as Array<{ token_address: string; chain: string; first_call: number }>;

    logger.info('Checking ClickHouse data', { tokenCount: rows.length });

    let foundCount = 0;
    let notFoundCount = 0;

    for (const row of rows) {
      const tokenAddress = row.token_address;
      const chain = row.chain;
      const callTimestamp = row.first_call;

      // Query for 1 hour before to 1 day after call
      const startTime = DateTime.fromSeconds(callTimestamp - 3600);
      const endTime = DateTime.fromSeconds(callTimestamp + 86400);

      try {
        const candles = await queryCandles(tokenAddress, chain, startTime, endTime, '5m');
        
        if (candles && candles.length > 0) {
          foundCount++;
          logger.info('✅ Found data in ClickHouse', {
            tokenAddress: tokenAddress.substring(0, 30),
            chain,
            candleCount: candles.length,
            firstCandle: new Date(candles[0].timestamp * 1000).toISOString(),
            lastCandle: new Date(candles[candles.length - 1].timestamp * 1000).toISOString(),
          });
        } else {
          notFoundCount++;
          logger.debug('❌ No data in ClickHouse', {
            tokenAddress: tokenAddress.substring(0, 30),
            chain,
            callTimestamp: new Date(callTimestamp * 1000).toISOString(),
          });
        }
      } catch (error: any) {
        notFoundCount++;
        logger.warn('Error querying ClickHouse', {
          tokenAddress: tokenAddress.substring(0, 30),
          error: error.message,
        });
      }

      // Small delay to avoid overwhelming ClickHouse
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info('ClickHouse data check complete', {
      total: rows.length,
      found: foundCount,
      notFound: notFoundCount,
      foundPercent: ((foundCount / rows.length) * 100).toFixed(1) + '%',
    });

  } catch (error: any) {
    logger.error('Error checking ClickHouse data', error as Error);
  } finally {
    await close();
  }
}

if (require.main === module) {
  checkClickHouseData().catch(error => {
    logger.error('Fatal error', error as Error);
    process.exit(1);
  });
}

export { checkClickHouseData };

