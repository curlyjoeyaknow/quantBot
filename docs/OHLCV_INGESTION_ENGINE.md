# OHLCV Ingestion Engine

## Overview

The `OhlcvIngestionEngine` is a core engine for fetching, caching, and managing OHLCV candle data from Birdeye. It provides intelligent fetching strategies, multi-layer caching, and incremental storage to prevent data loss.

## Key Features

### 1. **Metadata Enrichment First**
- Fetches token metadata (name, symbol) from Birdeye API before fetching candles
- Stores metadata in PostgreSQL using `TokensRepository`
- Enriches token details before inserting OHLCV candles
- Non-blocking: metadata fetch failure doesn't prevent candle fetching

### 2. **Intelligent Fetching Strategy**

#### 1-Minute Candles
- **Window**: -52 minutes before alert time
- **Limit**: Up to 5000 candles (max API limit)
- **Purpose**: High granularity data around alert time for precise entry pricing

#### 5-Minute Candles
- **Window**: -260 minutes (5 × 52) before alert time, up to current time
- **Chunking**: Fetched in chunks of 5000 candles (max API limit per call)
- **Purpose**: Standard granularity for full transaction history and Ichimoku calculations

### 3. **Multi-Layer Caching**

1. **In-Memory Cache (LRU)**
   - Fast access to recently fetched data
   - TTL: 5 minutes
   - Max entries: 500

2. **ClickHouse Cache**
   - Persistent storage for all fetched candles
   - Queried before making API calls
   - Acts as primary cache layer

3. **Cache Priority**
   - Check in-memory cache first
   - Then check ClickHouse
   - Finally fetch from Birdeye API if not in cache

### 4. **Incremental Storage**

- **Immediate Storage**: Each chunk of candles is stored to ClickHouse immediately after fetching
- **Data Loss Prevention**: Script failures don't lose already-fetched data
- **Resumable**: Can resume from last stored chunk if script is interrupted

## Usage

### Basic Usage

```typescript
import { getOhlcvIngestionEngine } from '@quantbot/ohlcv';
import { DateTime } from 'luxon';

const engine = getOhlcvIngestionEngine();

// Fetch candles for a token at alert time
const result = await engine.fetchCandles(
  '7pXs...pump', // Full mint address, case-preserved
  'solana',
  DateTime.fromISO('2024-01-15T10:30:00Z'), // Alert time
  {
    useCache: true, // Use cache (default: true)
    forceRefresh: false, // Force API call even if cached (default: false)
  }
);

console.log(`1m candles: ${result['1m'].length}`);
console.log(`5m candles: ${result['5m'].length}`);
console.log(`Metadata:`, result.metadata);
```

### Result Structure

```typescript
interface OhlcvIngestionResult {
  '1m': Candle[]; // 1-minute candles
  '5m': Candle[]; // 5-minute candles
  metadata: {
    tokenStored: boolean; // Whether metadata was stored
    total1mCandles: number; // Total 1m candles fetched
    total5mCandles: number; // Total 5m candles fetched
    chunksFetched: number; // Total chunks processed
    chunksFromCache: number; // Chunks retrieved from cache
    chunksFromAPI: number; // Chunks fetched from API
  };
}
```

### Options

```typescript
interface OhlcvIngestionOptions {
  useCache?: boolean; // Use cache before API calls (default: true)
  forceRefresh?: boolean; // Force refresh even if cached (default: false)
}
```

## Implementation Details

### Fetching Flow

1. **Initialize**: Ensure ClickHouse is ready
2. **Metadata**: Fetch and store token metadata
3. **1m Candles**: Fetch 1-minute candles (-52 minutes, max 5000)
4. **5m Candles**: Fetch 5-minute candles in chunks (-260 minutes to now, 5000 per chunk)
5. **Storage**: Each chunk is stored immediately after fetching

### Chunking Strategy

For 5-minute candles:
- Each chunk covers up to 5000 candles
- 5000 × 5 minutes = 25,000 minutes ≈ 17 days per chunk
- Chunks are fetched sequentially until reaching current time
- Each chunk is stored immediately to prevent data loss

### Error Handling

- **Metadata Fetch Failure**: Logged but doesn't block candle fetching
- **API Fetch Failure**: Thrown to caller for handling
- **Storage Failure**: Logged but doesn't prevent returning fetched data
- **Cache Query Failure**: Falls back to API fetch

## Cache Management

### Clear Cache

```typescript
engine.clearCache(); // Clear in-memory cache
```

### Cache Statistics

```typescript
const stats = engine.getCacheStats();
console.log(`Entries: ${stats.inMemoryEntries}`);
console.log(`Total candles: ${stats.cacheSize}`);
```

## Best Practices

1. **Always use full mint addresses**: The engine preserves case and full addresses
2. **Use cache by default**: Set `useCache: true` to minimize API calls
3. **Handle errors gracefully**: API failures should be caught and handled
4. **Monitor chunk counts**: Large time ranges will result in many chunks
5. **Resume on failure**: Scripts can resume from last stored chunk

## Integration with Existing Services

The engine can be used alongside existing OHLCV services:

- `OhlcvService`: High-level service for OHLCV operations
- `OhlcvRepository`: Direct database access
- `fetchHybridCandles`: Legacy fetching function (still supported)

## Performance Considerations

- **API Quota**: Each chunk uses 120 credits (5000 candles) or 60 credits (<1000 candles)
- **Rate Limiting**: Birdeye client handles rate limiting automatically
- **Cache Hit Rate**: High cache hit rates reduce API usage significantly
- **Storage Speed**: ClickHouse insertions are fast but should be monitored

## Example: Batch Processing

```typescript
const tokens = ['token1...', 'token2...', 'token3...'];
const alertTime = DateTime.fromISO('2024-01-15T10:30:00Z');

for (const token of tokens) {
  try {
    const result = await engine.fetchCandles(token, 'solana', alertTime);
    console.log(`✅ ${token}: ${result['1m'].length} 1m, ${result['5m'].length} 5m`);
  } catch (error) {
    console.error(`❌ ${token}: ${error.message}`);
    // Continue with next token
  }
}
```

## Migration from Old Services

If you're using `fetchHybridCandles` or `OhlcvService`, you can migrate to the new engine:

**Before:**
```typescript
const candles = await fetchHybridCandles(mint, startTime, endTime, chain, alertTime);
```

**After:**
```typescript
const result = await engine.fetchCandles(mint, chain, alertTime);
const candles = [...result['1m'], ...result['5m']];
```

The new engine provides better caching, incremental storage, and metadata enrichment.

