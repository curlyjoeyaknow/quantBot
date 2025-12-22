// Run OHLCV ingestion handler directly from source
import { ingestOhlcvHandler } from './packages/cli/src/handlers/ingestion/ingest-ohlcv.ts';
import { createCommandContext } from './packages/cli/src/core/command-context.ts';

console.log('🚀 Starting OHLCV ingestion...');
console.log('📁 DuckDB:', process.env.DUCKDB_PATH || 'data/result.duckdb');
console.log('📅 From: 2024-01-01');
console.log('📅 To: 2024-01-02');
console.log('');

try {
  const ctx = await createCommandContext();
  console.log('✓ Context created');
  
  console.log('✓ Starting ingestion...\n');
  
  const result = await ingestOhlcvHandler({
    from: '2024-01-01',
    to: '2024-01-02',
    preWindow: 260,
    postWindow: 1440,
    duckdb: process.env.DUCKDB_PATH || 'data/result.duckdb',
    format: 'table',
  });

  console.log('\n✅ INGESTION COMPLETE\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
}

