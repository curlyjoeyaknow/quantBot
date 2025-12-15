# @quantbot/ingestion

Data ingestion services for Telegram alerts and OHLCV candles.

## Services

- `TelegramAlertIngestionService`: parses Telegram exports, upserts tokens, inserts alerts and calls.
- `OhlcvIngestionService`: fetches OHLCV candles for calls using the new `OhlcvIngestionEngine` (metadata-first, cached, chunked, incremental storage). Also calculates and stores ATH/ATL metrics for alerts during ingestion.

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
