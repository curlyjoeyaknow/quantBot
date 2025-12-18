#!/usr/bin/env tsx
/**
 * Test script for OHLCV ingestion with DuckDB
 * Bypasses CLI infrastructure to test the core functionality
 */

import { OhlcvIngestionService } from '../packages/ingestion/src/OhlcvIngestionService.js';
import { AlertsRepository } from '../packages/storage/src/postgres/repositories/AlertsRepository.js';

async function main() {
  const duckdbPath = process.env.DUCKDB_PATH || process.argv[2] || 'data/tele.duckdb';
  const from = process.argv[3] ? new Date(process.argv[3]) : new Date('2025-12-01');
  const to = process.argv[4] ? new Date(process.argv[4]) : new Date('2025-12-16');

  console.log('Starting OHLCV ingestion test...');
  console.log({
    duckdbPath,
    from: from.toISOString(),
    to: to.toISOString(),
  });

  try {
    const service = new OhlcvIngestionService(new AlertsRepository());

    const result = await service.ingestForCalls({
      from,
      to,
      duckdbPath,
    });

    console.log('\n=== Ingestion Results ===');
    console.log(JSON.stringify(result, null, 2));

    console.log('\n=== Summary ===');
    console.log(`Tokens Processed: ${result.tokensProcessed}`);
    console.log(`Tokens Succeeded: ${result.tokensSucceeded}`);
    console.log(`Tokens Failed: ${result.tokensFailed}`);
    console.log(`1m Candles: ${result.candlesFetched1m}`);
    console.log(`5m Candles: ${result.candlesFetched5m}`);
    console.log(`Chunks from Cache: ${result.chunksFromCache}`);
    console.log(`Chunks from API: ${result.chunksFromAPI}`);

    if (result.errors.length > 0) {
      console.log('\n=== Errors ===');
      result.errors.forEach((error) => {
        console.log(`Token ${error.tokenId}: ${error.error}`);
      });
    }
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  }
}

main();
