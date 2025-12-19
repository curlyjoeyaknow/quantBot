# @quantbot/ingestion

**Offline-only data ingestion services for Telegram alerts and OHLCV work planning.**

This package provides offline parsing, worklist generation, and metadata management. It does **NOT** fetch data from APIs - that responsibility belongs to `@quantbot/jobs`.

## Architecture

- **Offline-only**: No network calls, no API clients, no environment variables
- **Work planning**: Generates worklists for OHLCV ingestion
- **Parsing**: Parses Telegram exports and extracts token/alert data
- **Metadata**: Manages OHLCV metadata and exclusions in DuckDB

## Services

### Telegram Ingestion
- `TelegramAlertIngestionService`: Parses Telegram exports, upserts tokens, inserts alerts and calls (offline parsing only).
- `TelegramCallIngestionService`: Orchestrates full Telegram ingestion workflow (offline parsing only).

### OHLCV Work Planning
- `generateOhlcvWorklist`: Generates worklist of OHLCV items to fetch by querying DuckDB (offline operation).

```typescript
import { generateOhlcvWorklist } from '@quantbot/ingestion';

// Generate worklist from DuckDB (offline)
const worklist = await generateOhlcvWorklist({
  duckdbPath: '/path/to/duckdb',
  from: '2024-01-01',
  to: '2024-01-02',
  side: 'buy',
});
```

### OHLCV Ingestion Service
- `OhlcvIngestionService`: Orchestrates OHLCV ingestion workflow (uses `@quantbot/jobs` for actual fetching).

## Usage

```typescript
import {
  TelegramAlertIngestionService,
  OhlcvIngestionService,
} from '@quantbot/ingestion';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';

// Telegram alerts
const telegramService = new TelegramAlertIngestionService(
  new CallersRepository(),
  new TokensRepository(),
  new AlertsRepository(),
  new CallsRepository()
);
await telegramService.ingestExport({
  filePath: '/path/messages.html',
  callerName: 'brook',
  chain: 'solana',
});

// OHLCV ingestion (calculates ATH/ATL automatically)
const ohlcvService = new OhlcvIngestionService(
  new CallsRepository(),
  new TokensRepository(),
  new AlertsRepository()
);
const result = await ohlcvService.ingestForCalls({
  from: new Date('2024-01-01'),
  to: new Date('2024-01-02'),
  preWindowMinutes: 260,
  postWindowMinutes: 1440,
});
console.log(result);
// ATH/ATL metrics are automatically calculated and stored in the alerts table
```

## Testing

```bash
cd packages/ingestion
npm test
```
