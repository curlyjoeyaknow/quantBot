# Birdeye API Rate Limit Analysis

## Current Situation

You've made **11,000 historical price calls (OHLCV)** today but **no other calls** (metadata, price, etc.).

## Root Cause

The Birdeye client uses a **single shared rate limiter** for all endpoints:
- **Limit**: 3000 requests/minute (50 requests/second)
- **Shared across**: All endpoints (OHLCV, metadata, price, etc.)
- **All keys share**: Same account limit (key rotation doesn't help)

### The Problem

1. **OHLCV calls consume all quota**: If you're making continuous OHLCV calls, they consume the entire 3000 req/min limit
2. **Other calls wait**: Metadata/price calls wait for the rate limiter, but never get through because OHLCV keeps consuming quota
3. **No endpoint prioritization**: All endpoints compete equally for the same quota

## Diagnosis

Run these scripts to see what's happening:

```bash
# Check overall usage stats
ts-node scripts/diagnose-birdeye-usage.ts

# Check endpoint distribution (requires event log)
ts-node scripts/analyze-birdeye-endpoints.ts
```

## Solutions

### Option 1: Separate Rate Limiters (Recommended)

Create separate rate limiters for different endpoint types:

```typescript
// High-priority endpoints (metadata, price) - 500 req/min
const metadataRateLimiter = new RateLimiter({
  maxRequests: 500,
  windowMs: 60000,
});

// Low-priority endpoints (OHLCV) - 2500 req/min
const ohlcvRateLimiter = new RateLimiter({
  maxRequests: 2500,
  windowMs: 60000,
});
```

This ensures metadata/price calls always have quota available.

### Option 2: Reduce OHLCV Concurrency

Reduce concurrent OHLCV fetches to leave quota for other endpoints:

```typescript
// In OhlcvIngestionService.ts
const CONCURRENT_TOKENS = 2; // Down from 5
```

### Option 3: Use Storage More

- Check coverage before fetching OHLCV (already implemented)
- Use ClickHouse/DuckDB for metadata instead of API
- Cache metadata aggressively

### Option 4: Endpoint Prioritization

Implement a priority queue where:
- High-priority endpoints (metadata, price) get quota first
- OHLCV calls wait if high-priority calls are pending

## Immediate Fix

The quickest fix is to **reduce OHLCV concurrency**:

```typescript
// packages/ingestion/src/OhlcvIngestionService.ts
const CONCURRENT_TOKENS = 2; // Reduce from 5 to 2
```

This leaves ~40% of quota available for other endpoints.

## Expected Results

After reducing concurrency:
- **OHLCV calls**: ~1200-1500 req/min (down from 3000)
- **Other calls**: ~1500-1800 req/min available
- **Metadata/price calls**: Should now succeed

## Monitoring

Check endpoint distribution:
```bash
ts-node scripts/analyze-birdeye-endpoints.ts
```

This will show:
- Which endpoints are being called
- Call counts per endpoint
- Success/failure rates
- Rate limit errors


