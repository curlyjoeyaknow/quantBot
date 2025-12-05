# Birdeye Transactions API Analysis

## Transaction Endpoint Limits

### Time Range Constraints
- **Maximum time range: 30 days**
  - When using `after_time` and `before_time` parameters
  - If only `after_time` is provided (no `before_time`), it must be within the last 30 days

### Block Range Constraints
- **Maximum block range: 500,000 blocks**
  - When using `after_block_number` and `before_block_number` parameters
  - If only `after_block_number` is provided, it must be within the most recent 500,000 blocks

### Filtering Rules
- Only one type of filter is accepted: either block time range OR block number range (not both)
- If filtering by block time, only allow sorting by `block_unix_time`
- If filtering by block number, only allow sorting by `block_number`

### Default Behavior
- If no time/block range provided:
  - If `sort_by = block_unix_time`: defaults to last 7 days
  - If `sort_by = block_number`: defaults to last 500,000 blocks

### Pagination
- The API has a `limit` parameter (visible in the API docs)
- **Note**: The exact default/maximum limit value is not explicitly stated in the documentation
- For large datasets, you'll need to make multiple requests in 30-day chunks
- Each request can fetch up to the limit (likely 100-1000 transactions per page based on typical API patterns)

## Cost Analysis

### Credit Usage
- The transaction endpoint appears to be relatively cheap compared to OHLCV endpoints
- No explicit credit cost mentioned in the docs (unlike OHLCV which costs 120 credits for 5000 candles)
- This makes it a cost-effective way to fetch transaction history

### Strategy for Fetching Full History
1. **Chunk requests into 30-day periods**
2. **Use pagination** with the `limit` parameter to fetch all transactions within each 30-day window
3. **Sort by `block_unix_time`** for chronological ordering
4. **Make parallel requests** for different time periods to speed up data collection

## Address Normalization (DexScreener/Solscan Pattern)

### Observation
Both DexScreener and Solscan handle Solana addresses in a case-insensitive manner:

1. **DexScreener**: Successfully loads pages with lowercase addresses
   - Example: `https://dexscreener.com/solana/9mlzegmatpitzp3ps9eguc4gwmlyv8pxtkmfukhvpump` works
   - Their API calls normalize addresses to lowercase: `4ymt51h1rnvxidwiv1g1zxhx8iezyhmfhtxdc7pbtn4w`

2. **Solscan**: Shows "Token not found" for lowercase addresses
   - However, this may be a frontend validation issue rather than backend normalization
   - Their backend likely normalizes addresses before querying

### Implementation Pattern
Services normalize Solana addresses by:
1. **Converting to lowercase** before database/API queries
2. **Storing normalized addresses** in their database
3. **Accepting any case** in user input and normalizing it

### Technical Note
- Solana addresses use **Base58 encoding** which is technically case-sensitive
- However, the actual address validation happens at the blockchain level
- Services can normalize addresses because:
  - Base58 decoding is case-sensitive, but they can try multiple case variations
  - OR they maintain a mapping of normalized addresses to actual addresses
  - OR they query by case-insensitive matching in their database

### Recommendation for Our Codebase
Since Birdeye API is case-sensitive (as we've seen with OHLCV endpoints), we should:
1. **Store addresses with correct case** (as we're doing with the re-extraction script)
2. **Normalize addresses only for display/comparison** purposes
3. **Use exact case** when making Birdeye API calls
4. **Consider implementing a case-insensitive lookup** in our own database for user queries

## Example Implementation

```typescript
/**
 * Normalize Solana address for comparison/lookup (but keep original for API calls)
 */
function normalizeAddressForLookup(address: string): string {
  // For internal database lookups, we can use lowercase
  // But for API calls, use the original case
  return address.toLowerCase();
}

/**
 * Fetch transactions from Birdeye in 30-day chunks
 */
async function fetchAllTransactions(
  tokenAddress: string, // Use exact case for API
  startTime: Date,
  endTime: Date
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  const chunkSize = 30 * 24 * 60 * 60 * 1000; // 30 days in ms
  
  let currentStart = startTime;
  
  while (currentStart < endTime) {
    const currentEnd = new Date(Math.min(
      currentStart.getTime() + chunkSize,
      endTime.getTime()
    ));
    
    const chunk = await fetchBirdeyeTransactions({
      address: tokenAddress, // Exact case
      after_time: Math.floor(currentStart.getTime() / 1000),
      before_time: Math.floor(currentEnd.getTime() / 1000),
      limit: 1000, // Adjust based on actual API limit
      sort_by: 'block_unix_time'
    });
    
    transactions.push(...chunk);
    currentStart = currentEnd;
  }
  
  return transactions;
}
```

