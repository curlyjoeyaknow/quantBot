# Token Metadata & Multi-Timeframe Support

## Overview

The Storage Engine now supports:
1. **Separate token metadata storage** - Time-series snapshots of token metadata (market cap, price, volume, etc.) stored separately from candles
2. **Multi-timeframe candle handling** - Support for multiple candle intervals with validation and parallel fetching

## Token Metadata Storage

### Architecture

Token metadata is stored in ClickHouse `token_metadata` table, separate from candles. This allows:
- Tracking metadata changes over time
- Historical analysis of market cap, volume, price changes
- Efficient queries for latest metadata
- Time-series analysis of token metrics

### Schema

```sql
CREATE TABLE token_metadata (
  token_address String,        -- Full mint address, case-preserved
  chain String,
  timestamp DateTime,
  name String,
  symbol String,
  decimals Nullable(UInt8),
  price Nullable(Float64),
  market_cap Nullable(Float64),
  volume_24h Nullable(Float64),
  price_change_24h Nullable(Float64),
  logo_uri Nullable(String),
  socials_json String,          -- JSON: {twitter, telegram, discord, website}
  creator Nullable(String),
  top_wallet_holdings Nullable(Float64),
  metadata_json String           -- Additional metadata as JSON
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp)
```

### Usage

```typescript
import { getStorageEngine } from '@quantbot/storage';

const engine = getStorageEngine();

// Store metadata snapshot
await engine.storeTokenMetadata(
  '7pXs...pump', // Full mint address
  'solana',
  Date.now() / 1000, // Unix timestamp
  {
    name: 'Test Token',
    symbol: 'TEST',
    price: 0.001,
    marketCap: 1000000,
    volume24h: 50000,
    priceChange24h: 10.5,
    socials: {
      twitter: 'https://twitter.com/test',
      telegram: 'https://t.me/test',
    },
  }
);

// Get latest metadata
const latest = await engine.getLatestTokenMetadata(
  '7pXs...pump',
  'solana'
);

// Get metadata history
const history = await engine.getTokenMetadataHistory(
  '7pXs...pump',
  'solana',
  startTime,
  endTime
);
```

## Multi-Timeframe Candle Support

### Supported Intervals

- `1m` - 1 minute candles (high granularity, precise entry pricing)
- `5m` - 5 minute candles (standard, default)
- `15m` - 15 minute candles
- `1h` - 1 hour candles
- `4h` - 4 hour candles
- `1d` - Daily candles

### Features

1. **Interval Validation**: Invalid intervals throw errors
2. **Parallel Fetching**: Fetch multiple intervals simultaneously
3. **Separate Caching**: Each interval cached independently
4. **Optimized Queries**: Interval-specific queries for performance

### Usage

```typescript
// Single interval
const candles = await engine.getCandles(
  '7pXs...pump',
  'solana',
  startTime,
  endTime,
  { interval: '1m' } // High precision for entry timing
);

// Multiple intervals in parallel
const multiInterval = await engine.getCandlesMultiInterval(
  '7pXs...pump',
  'solana',
  startTime,
  endTime,
  ['1m', '5m', '1h'] // Fetch all at once
);

// Access results
const oneMinute = multiInterval.get('1m');
const fiveMinute = multiInterval.get('5m');
const oneHour = multiInterval.get('1h');
```

### Use Cases

1. **Entry Timing**: Use `1m` candles for precise entry pricing around alert time
2. **Overview Analysis**: Use `5m` or `15m` for general trend analysis
3. **Long-term Trends**: Use `1h`, `4h`, or `1d` for macro trends
4. **Multi-timeframe Analysis**: Combine intervals for comprehensive analysis

## Implementation Details

### Mint Address Preservation

✅ **CRITICAL**: All metadata operations preserve full mint addresses and exact case:
- Storage: Full address stored as-is
- Queries: Case-preserved matching
- Display: Only truncated for logging

### Caching Strategy

- **Metadata**: Latest metadata cached with TTL
- **Candles**: Each interval cached separately
- **Invalidation**: Cache cleared on writes

### Performance

- **Parallel Fetching**: Multiple intervals fetched concurrently
- **Partitioning**: ClickHouse tables partitioned by month
- **Indexing**: Optimized ORDER BY for time-range queries

## Migration

The new functionality is backward compatible:
- Existing code using default `5m` interval continues to work
- Metadata storage is optional (can be added incrementally)
- No breaking changes to existing APIs

## Examples

### Complete Workflow

```typescript
const engine = getStorageEngine();

// 1. Store candles for multiple intervals
await engine.storeCandles(tokenAddress, chain, candles1m, '1m');
await engine.storeCandles(tokenAddress, chain, candles5m, '5m');

// 2. Store metadata snapshot
await engine.storeTokenMetadata(
  tokenAddress,
  chain,
  timestamp,
  {
    name: 'Token Name',
    symbol: 'SYMBOL',
    price: 0.001,
    marketCap: 1000000,
  }
);

// 3. Retrieve multi-timeframe candles
const candles = await engine.getCandlesMultiInterval(
  tokenAddress,
  chain,
  startTime,
  endTime,
  ['1m', '5m']
);

// 4. Get latest metadata
const metadata = await engine.getLatestTokenMetadata(tokenAddress, chain);

// 5. Analyze with both candles and metadata
const oneMinute = candles.get('1m');
const fiveMinute = candles.get('5m');
const currentPrice = metadata?.price;
const marketCap = metadata?.marketCap;
```

## Testing

Comprehensive tests cover:
- ✅ Metadata storage with mint preservation
- ✅ Latest metadata retrieval
- ✅ Metadata history queries
- ✅ Multi-interval candle fetching
- ✅ Interval validation
- ✅ Case sensitivity

See `tests/TokenMetadataRepository.test.ts` for examples.

