// OHLCV ingestion with logging
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

console.log('Starting OHLCV ingestion...');
console.log('DuckDB path:', process.env.DUCKDB_PATH || 'data/result.duckdb');
console.log('Date range: 2024-01-01 to 2024-01-02');
console.log('');

// Use dynamic import to handle CommonJS/ESM interop
try {
  const ingestion = await import('./packages/ingestion/dist/index.js');
  console.log('✓ Loaded ingestion module');
  
  const { OhlcvIngestionService } = ingestion;
  console.log('✓ Created service instance');
  
  const service = new OhlcvIngestionService();
  console.log('✓ Starting ingestion...');
  console.log('');
  
  const result = await service.ingestForCalls({
    from: new Date('2024-01-01'),
    to: new Date('2024-01-02'),
    preWindowMinutes: 260,
    postWindowMinutes: 1440,
    duckdbPath: process.env.DUCKDB_PATH || 'data/result.duckdb',
  });
  
  console.log('');
  console.log('=== INGESTION COMPLETE ===');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
}

