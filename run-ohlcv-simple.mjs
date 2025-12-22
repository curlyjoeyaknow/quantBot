// Simple OHLCV ingestion runner
import { OhlcvIngestionService } from '@quantbot/ingestion';

const service = new OhlcvIngestionService();
const result = await service.ingestForCalls({
  from: new Date('2024-01-01'),
  to: new Date('2024-01-02'),
  preWindowMinutes: 260,
  postWindowMinutes: 1440,
  duckdbPath: process.env.DUCKDB_PATH || 'data/result.duckdb',
});

console.log(JSON.stringify(result, null, 2));

