# Address Extraction and Validation Module

Two-pass validation system for cryptocurrency addresses (Solana and EVM).

## Architecture

### Pass 1: Extraction-Time (Fast, Deterministic, No Network)
- **Location**: `extract-candidates.ts`
- **Purpose**: Fast filter to identify potential addresses from text
- **Validation**: Length, charset, basic format checks
- **Output**: `AddressCandidate[]` with Pass 1 validation status

### Pass 2: Pre-Persist (Authoritative Validation)
- **Location**: `validate.ts`
- **Purpose**: Syntactic validation before database write
- **Solana**: PublicKey parse (base58 decode → exactly 32 bytes)
- **EVM**: EIP-55 checksum validation
- **Output**: `ValidationResult` with normalized address and status

### Pass 3: Semantic Verification (Optional, at OHLCV Fetch Time)
- **Location**: Not in this module (handled by OHLCV ingestion)
- **Purpose**: Verify address exists in market data (Birdeye, etc.)
- **Cost Boundary**: Only called when fetching OHLCV data

## Usage

```typescript
import { extractCandidates } from '@quantbot/utils/address';
import { validateSolanaMint, validateEvmAddress } from '@quantbot/utils/address';

// Pass 1: Extract candidates
const text = 'CA: So11111111111111111111111111111111111111112';
const candidates = extractCandidates(text);

// Pass 2: Validate
for (const candidate of candidates) {
  if (candidate.reason) continue; // Pass 1 rejected
  
  if (candidate.addressType === 'solana') {
    const result = validateSolanaMint(candidate.normalized);
    if (result.ok) {
      // Persist result.normalized
    }
  } else if (candidate.addressType === 'evm') {
    const result = validateEvmAddress(candidate.normalized);
    if (result.ok) {
      // Persist result.normalized (lowercase for EVM)
    }
  }
}
```

## Test Suite

### Pass 1 Tests
- **Unit Tests**: `tests/unit/address/extract-candidates.test.ts`
  - Punctuation stripping
  - Multiple addresses
  - Deduplication
  - False positive rejection
  - Mixed content handling
  - Solana/EVM extraction cases

- **Property Tests**: `tests/properties/address-extraction.test.ts`
  - Normalization stability (fast-check)
  - Case preservation
  - Idempotency

### Pass 2 Tests
- **Validation Tests**: `tests/unit/address/validate.test.ts`
  - Solana PublicKey parse validation
  - EVM EIP-55 checksum validation
  - Edge cases

### Pipeline Tests
- **Integration Tests**: `tests/integration/address-pipeline.test.ts`
  - Pass 2 before DB writes
  - Deduplication behavior
  - Pipeline flow

- **Semantic Tests**: `tests/integration/address-semantic.test.ts`
  - OHLCV provider mocking
  - Failure caching
  - Semantic verification flow

### Regression Tests
- **Fixtures**: `tests/fixtures/telegram-messages.json`
- **Tests**: `tests/integration/address-regression.test.ts`
  - Real Telegram message samples
  - Edge cases that previously broke parsing

## Key Principles

1. **Case Preservation**: Solana addresses preserve exact case (base58 is case-sensitive)
2. **Normalization**: EVM addresses normalized to lowercase for storage
3. **No Truncation**: Full addresses always preserved
4. **Deduplication**: Within-message deduplication at extraction time
5. **Separation of Concerns**: Extraction (Pass 1) vs Validation (Pass 2) vs Semantic (Pass 3)

## Running Tests

```bash
# All address tests
npm test -- address

# Specific test file
npm test -- extract-candidates.test.ts

# With coverage
npm test -- address --coverage
```

