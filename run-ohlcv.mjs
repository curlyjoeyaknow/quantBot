// Run OHLCV ingestion using the handler directly
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

console.log('🚀 Starting OHLCV ingestion...');
console.log('📁 DuckDB:', process.env.DUCKDB_PATH || 'data/result.duckdb');
console.log('📅 From: 2024-01-01');
console.log('📅 To: 2024-01-02');
console.log('');

// Import as CommonJS
const ingestion = require('./packages/ingestion/dist/index.js');
const { OhlcvIngestionService } = ingestion;

console.log('✓ Service loaded, initializing...');

const service = new OhlcvIngestionService();

console.log('✓ Starting ingestion...\n');

try {
  const result = await service.ingestForCalls({
    from: new Date('2024-01-01'),
    to: new Date('2024-01-02'),
    preWindowMinutes: 260,
    postWindowMinutes: 1440,
    duckdbPath: process.env.DUCKDB_PATH || 'data/result.duckdb',
  });

  console.log('\n✅ INGESTION COMPLETE\n');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
}
