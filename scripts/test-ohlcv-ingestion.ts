#!/usr/bin/env tsx
/**
 * Test script for OHLCV ingestion with DuckDB
 * Uses the ingestOhlcv workflow instead of calling services directly
 */

import { ingestOhlcv, createOhlcvIngestionContext } from '../packages/workflows/src/index.js';
import { OhlcvBirdeyeFetch } from '../packages/jobs/src/index.js';

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || process.argv[2] || 'data/tele.duckdb';
  const from = process.argv[3] || '2025-12-01';
  const to = process.argv[4] || '2025-12-16';

  console.log('Starting OHLCV ingestion test...');
  console.log({
    duckdbPath,
    from,
    to,
  });

  try {
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
        from,
        to,
        side: 'buy',
        chain: 'solana',
        interval: '1m',
        preWindowMinutes: 260,
        postWindowMinutes: 1440,
        errorMode: 'collect',
        checkCoverage: true,
        rateLimitMs: 100,
        maxRetries: 3,
      },
      workflowContext
    );

    console.log('\n=== Ingestion Results ===');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n=== Summary ===');
    console.log(`Worklist Generated: ${result.worklistGenerated}`);
    console.log(`Work Items Processed: ${result.workItemsProcessed}`);
    console.log(`Work Items Succeeded: ${result.workItemsSucceeded}`);
    console.log(`Work Items Failed: ${result.workItemsFailed}`);
    console.log(`Work Items Skipped: ${result.workItemsSkipped}`);
    console.log(`Total Candles Fetched: ${result.totalCandlesFetched}`);
    console.log(`Total Candles Stored: ${result.totalCandlesStored}`);

    if (result.errors.length > 0) {
      console.log('\n=== Errors ===');
      result.errors.forEach((error) => {
        console.log(`${error.mint.substring(0, 20)}... (${error.chain}): ${error.error}`);
      });
    }
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();
