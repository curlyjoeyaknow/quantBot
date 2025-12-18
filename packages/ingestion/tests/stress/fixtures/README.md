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

