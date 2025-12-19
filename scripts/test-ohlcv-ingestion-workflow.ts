#!/usr/bin/env tsx

/**
 * Test script for OHLCV ingestion workflow
 * Tests the workflow for date range: 2025-07-15 to 2025-07-16
 */

import { ingestOhlcv, createOhlcvIngestionContext } from '../packages/workflows/src/ohlcv/ingestOhlcv.js';
import type { IngestOhlcvSpec } from '../packages/workflows/src/ohlcv/ingestOhlcv.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

async function testOhlcvIngestion() {
  console.log('🧪 Testing OHLCV ingestion workflow...\n');
  console.log('Date range: 2025-07-15 to 2025-07-16\n');

  // Get DuckDB path from environment or use default
  const duckdbPath = process.env.DUCKDB_PATH || './data/tele.duckdb';
  console.log(`Using DuckDB: ${duckdbPath}\n`);

  const spec: IngestOhlcvSpec = {
    duckdbPath,
    from: '2025-07-15',
    to: '2025-07-16',
    side: 'buy',
    chain: 'solana',
    interval: '1m',
    preWindowMinutes: 260,
    postWindowMinutes: 1440,
    errorMode: 'collect',
    checkCoverage: true,
    rateLimitMs: 100,
    maxRetries: 3,
  };

  console.log('Spec:', JSON.stringify(spec, null, 2));
  console.log('\n🚀 Starting workflow...\n');

  try {
    const context = createOhlcvIngestionContext();
    const result = await ingestOhlcv(spec, context);

    console.log('\n✅ Workflow completed successfully!\n');
    console.log('Results:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\n❌ Workflow failed:');
    console.error(error);
    process.exit(1);
  }
}

testOhlcvIngestion();

