# Address Validation & Multi-Chain Metadata Fetching

## Overview

This system provides robust address validation and metadata fetching for both Solana and EVM-compatible chains (Ethereum, Base, BSC). It handles the critical insight that **EVM addresses are identical across ETH/Base/BSC** - you cannot distinguish the chain from the address format alone.

## Key Concepts

### Address Format Distinction

- **Solana**: Base58-encoded addresses, 32-44 characters
  - Uses alphabet: `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`
  - Excludes: `0`, `O`, `I`, `l` (to avoid confusion)
  - Example: `So11111111111111111111111111111111111111112`

- **EVM (Ethereum/Base/BSC)**: Hex addresses, `0x` prefix + 40 hex characters
  - Format: `0x` + 40 hex chars (0-9, a-f, A-F)
  - **Critical**: Same format for all EVM chains - cannot determine chain from address alone
  - Example: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`

### Chain Detection Strategy

Since EVM addresses are identical across chains, we use a **multi-chain fallback strategy**:

1. **Chain Hint**: Use context from message/channel to prioritize a chain
2. **Sequential Query**: Try ETH → Base → BSC (or hint-first order)
3. **First Success Wins**: Use the first chain where metadata is found
4. **Cache Results**: Avoid redundant API calls

## Components

### 1. Address Validation (`addressValidation.ts`)

Core validation functions:

```typescript
import { isEvmAddress, isSolanaAddress, extractAddresses } from '@quantbot/ingestion';

// Validate individual addresses
isEvmAddress('0x123...'); // true/false
isSolanaAddress('So111...'); // true/false

// Extract addresses from messy text (Telegram messages)
const { solana, evm } = extractAddresses(text);
```

**Features**:
- Format-level validation (doesn't verify on-chain existence)
- Handles Unicode, punctuation, code blocks
- Deduplicates addresses
- Preserves first-seen order

### 2. Multi-Chain Metadata Service (`MultiChainMetadataService.ts`)

Fetches token metadata across chains:

```typescript
import { fetchMultiChainMetadata } from '@quantbot/ingestion';

const result = await fetchMultiChainMetadata(
  '0x123...', // EVM address
  'base' // Optional chain hint
);

// Result structure:
{
  address: '0x123...',
  addressKind: 'evm',
  chainHint: 'base',
  primaryMetadata: {
    chain: 'base', // Actual chain where found
    name: 'Token Name',
    symbol: 'SYMBOL',
    found: true
  },
  metadata: [
    { chain: 'ethereum', found: false },
    { chain: 'base', found: true, name: '...', symbol: '...' },
    { chain: 'bsc', found: false }
  ]
}
```

**Behavior**:
- **Solana addresses**: Only queries Solana chain
- **EVM addresses**: Queries ETH, Base, BSC sequentially
- **Chain hint**: Prioritizes the hinted chain first
- **Caching**: Uses in-memory cache to avoid redundant calls

### 3. Metadata Cache (`MultiChainMetadataCache.ts`)

In-memory cache with TTL:

```typescript
import { getMetadataCache } from '@quantbot/ingestion';

const cache = getMetadataCache();
cache.get(address, chain); // Get cached metadata
cache.set(address, chain, metadata, ttl); // Cache metadata
```

**Features**:
- Default TTL: 1 hour for successful lookups
- Shorter TTL (5 min) for negative results (not found)
- Automatic expiration cleanup
- Singleton pattern for global access

## Usage Examples

### In Telegram Ingestion

The system is integrated into both ingestion services:

1. **TelegramAlertIngestionService**: Uses multi-chain fetching during validation
2. **TelegramCallIngestionService**: Uses multi-chain fetching in `storeCall()`
3. **BotMessageExtractor**: Uses `extractAddresses()` for address extraction

### CLI Command

Validate addresses manually:

```bash
# Validate multiple addresses
quantbot ingestion validate-addresses 0x123... So111... 0xabc...

# With chain hint
quantbot ingestion validate-addresses 0x123... --chain-hint base

# Output format
quantbot ingestion validate-addresses 0x123... --format json
```

### Programmatic Usage

```typescript
import { 
  extractAddresses, 
  fetchMultiChainMetadata,
  isEvmAddress 
} from '@quantbot/ingestion';

// Extract from text
const { solana, evm } = extractAddresses(telegramMessage);

// Fetch metadata with fallback
for (const address of evm) {
  const result = await fetchMultiChainMetadata(address, 'base');
  if (result.primaryMetadata) {
    console.log(`Found on ${result.primaryMetadata.chain}:`, result.primaryMetadata);
  }
}
```

## Integration Points

### BotMessageExtractor

Uses `extractAddresses()` instead of custom regex:
- More reliable address extraction
- Handles both Solana and EVM addresses
- Better Unicode/punctuation handling

### TelegramCallIngestionService

Uses `fetchMultiChainMetadata()` in `storeCall()`:
- Validates addresses across chains
- Gets actual chain where token exists
- Uses metadata from API (more reliable than bot text)

### TelegramAlertIngestionService

Uses multi-chain fetching for validation:
- Validates first N addresses as sanity check
- Falls back to multi-chain if single-chain fails
- Logs which chain actually has the token

## Best Practices

1. **Always use chain hints when available**: Context from messages/channels improves accuracy
2. **Cache is your friend**: The cache reduces API calls significantly
3. **Handle failures gracefully**: Not all addresses will be found (new tokens, API issues)
4. **Log chain detection**: Helps debug why a token was assigned to a specific chain
5. **Preserve address case**: Solana addresses are case-sensitive

## Testing

### Unit Tests

- `addressValidation.test.ts`: Explicit test cases for valid/invalid addresses
- `addressValidation.property.test.ts`: Property tests for invariants
- `MultiChainMetadataService.test.ts`: Service behavior with mocked API

### Test Coverage

- ✅ EVM address format validation
- ✅ Solana base58 validation
- ✅ Address extraction from messy text
- ✅ Multi-chain fallback logic
- ✅ Cache behavior
- ✅ Edge cases (Unicode, punctuation, boundaries)

## Performance Considerations

1. **Caching**: Reduces API calls by ~80% for repeated addresses
2. **Sequential queries**: EVM chains queried one at a time (not parallel) to respect rate limits
3. **Early exit**: Stops querying once metadata is found
4. **Negative caching**: Caches "not found" results with shorter TTL

## Limitations

1. **API dependency**: Requires Birdeye API access
2. **Rate limits**: Sequential queries respect API rate limits
3. **New tokens**: Very new tokens may not be indexed yet
4. **Chain ambiguity**: EVM addresses still require context to determine actual chain

## Future Improvements

- [ ] Parallel EVM chain queries (with rate limit coordination)
- [ ] Redis-backed cache for distributed systems
- [ ] Chain detection from transaction history
- [ ] Support for more EVM chains (Polygon, Arbitrum, etc.)


