# API Rate Limiting Fix

## The Problem

You're getting 13,435 403 errors because:

1. **Single shared rate limiter**: All API keys share one rate limiter (3000 rpm total)
2. **Too many parallel requests**: 5 concurrent tokens × 4 API calls = 20 requests at once
3. **Account-level limit**: Birdeye's 3000 rpm limit is per account, not per key

**Key rotation doesn't help** because all keys hit the same account limit.

## The Real Solution

### 1. Reduce Parallel Concurrency

Currently: `CONCURRENT_TOKENS = 5` (line 273 in `OhlcvIngestionService.ts`)

**Fix**: Reduce to 2-3 concurrent tokens to stay well under 50 RPS:

```typescript
// packages/ingestion/src/OhlcvIngestionService.ts
const CONCURRENT_TOKENS = 2; // Down from 5
```

This gives you:
- 2 tokens × 4 API calls = 8 requests at once
- Well under 50 RPS limit
- More predictable rate limiting

### 2. Increase Rate Limit Delay

Currently: `rateLimitMs: 100` (10 requests/second)

**Fix**: Increase to 25ms (40 requests/second, safe margin):

```typescript
// When creating OhlcvBirdeyeFetch
new OhlcvBirdeyeFetch({
  rateLimitMs: 25, // Up from 100 (40 RPS = safe margin under 50 RPS)
  maxRetries: 3,
  checkCoverage: true,
})
```

### 3. Use Storage More

✅ **Already fixed**: Lab command now uses DuckDB/ClickHouse instead of API

**Do this**: Always check coverage before fetching:
- Already implemented in `OhlcvBirdeyeFetch`
- Skips fetch if coverage >= 95%
- Saves ~50% of API calls

### 4. Better Rate Limiter

The current rate limiter is per-client, not global. If you have multiple instances, they don't coordinate.

**Fix**: Use a global rate limiter or reduce concurrency further.

## Immediate Actions

1. **Reduce concurrency** in `OhlcvIngestionService.ts`:
   ```typescript
   const CONCURRENT_TOKENS = 2; // Down from 5
   ```

2. **Increase rate limit delay**:
   ```typescript
   rateLimitMs: 25, // Up from 100
   ```

3. **Use storage-based workflows** (already done for lab):
   ```bash
   # Lab now uses storage automatically
   quantbot lab run --overlays '[...]'
   ```

4. **Check coverage before fetching** (already implemented):
   - Skips unnecessary API calls
   - Saves ~50% of requests

## Expected Results

After these changes:
- **403 errors**: Should drop significantly (from 13k+ to <100)
- **Success rate**: Should improve (more 200s, fewer 403s)
- **Throughput**: Slightly slower, but more reliable

## Why Key Rotation Doesn't Help

- All keys share the same account rate limit (3000 rpm)
- Rate limiter is shared across all keys
- Rotating keys doesn't increase your limit
- The limit is account-level, not per-key

**The fix is reducing parallel requests, not rotating keys.**

