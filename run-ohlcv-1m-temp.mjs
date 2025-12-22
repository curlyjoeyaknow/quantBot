// Temporary script to run OHLCV ingestion for 1m candles
import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname);
const duckdbPath = path.resolve(projectRoot, 'data/result.duckdb');

const spec = {
  duckdbPath,
  interval: '1m',
  preWindowMinutes: 260,
  postWindowMinutes: 1440,
  side: 'buy',
  errorMode: 'collect',
  checkCoverage: true,
  rateLimitMs: 330,
  maxRetries: 3,
};

console.log('Starting OHLCV ingestion for 1m candles...');
console.log('DuckDB path:', duckdbPath);

const ctx = await createOhlcvIngestionContext();
const result = await ingestOhlcv(spec, ctx);

console.log('\n=== Results ===');
console.log(JSON.stringify(result, null, 2));

