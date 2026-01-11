# Stress Test Fixtures

This directory contains shared fixtures for stress testing.

## Files

### `malicious-addresses.ts`

Edge cases for address extraction and validation:

- **Punctuation cases**: Addresses wrapped in `()`, `""`, with trailing `,`, `.`, `]`
- **Invisible characters**: Zero-width spaces, non-breaking spaces, soft hyphens
- **Line breaks**: Newlines, carriage returns, tabs mid-address
- **Markdown**: Inline code, code blocks, bold, links
- **URLs**: Base58-ish strings in URLs (should not be extracted)
- **Noise**: Tickers like `$SOL`, `SOL/USDT`, token names
- **Obfuscation**: Spaces in addresses, Cyrillic characters, lookalikes
- **Solana validation**: Forbidden chars (`0`, `O`, `I`, `l`), length issues
- **EVM validation**: Invalid hex, checksum errors, zero address

### `malformed-json.ts`

Invalid Python tool outputs for contract brutality tests:

- **Malformed JSON**: Not JSON, partial, invalid syntax, empty
- **Wrong schema**: Type mismatches, arrays instead of objects
- **Missing fields**: Required fields omitted
- **Process failures**: Nonzero exit codes, stderr, timeouts
- **Stdout contamination**: Logs mixed with JSON data
- **Huge outputs**: Exceeding maxBuffer limits

### `pathological-ohlcv.ts`

Extreme edge cases for OHLCV ingestion stress testing:

- **Invalid Mints**: Empty strings, too short/long, forbidden characters, zero addresses
- **Extreme Date Ranges**: Future dates, very old dates, reversed ranges, same start/end, huge ranges, tiny ranges, invalid timestamps
- **Pathological Candles**: Empty arrays, negative prices, zero prices, high < low, invalid values (NaN, Infinity), duplicates, out-of-order, huge gaps, maximum candles (5000), over maximum (5001), flatlines, extreme spikes, near-zero prices, invalid timestamps, mixed valid/invalid
- **API Failure Scenarios**: Empty responses, malformed JSON, missing fields, rate limits (429), server errors (500), not found (404), timeouts, partial responses, wrong data structures
- **Cache Corruption**: Stale cache, corrupted entries, wrong data types, empty entries, wrong mint
- **Storage Failures**: Connection failures, query timeouts, disk full, partial writes, schema mismatches, concurrent conflicts
- **Resource Exhaustion**: Too many concurrent requests, very large responses, memory exhaustion, cache overflow

### `nasty-candles.ts`

Pathological candle sequences for simulation stress tests:

- **Flatline**: Constant price, zero volume
- **Spikes**: Extreme outliers, near-zero prices, volume spikes
- **Gaps**: Missing candles, large gaps
- **Duplicates**: Same timestamp with same/different data
- **Out-of-order**: Non-monotonic timestamps, reversed
- **Invalid**: Negative prices, zero prices, high < low
- **Tiny**: Insufficient data for indicators
- **Ambiguity**: Stop + target in same candle, entry + exit in same candle

## Usage

Import fixtures in your stress tests:

```typescript
import {
  PUNCTUATION_CASES,
  INVISIBLE_CASES,
  SOLANA_VALIDATION_CASES,
  type AddressTestCase,
} from '../fixtures/malicious-addresses.js';

describe('Address Extraction', () => {
  PUNCTUATION_CASES.forEach((testCase) => {
    it(testCase.description, () => {
      const result = extractAddress(testCase.input);
      // Assert...
    });
  });
});
```

## Adding New Fixtures

1. Add to appropriate file (or create new file)
2. Export as named constant
3. Include type definitions
4. Document expected behavior
5. Update this README

