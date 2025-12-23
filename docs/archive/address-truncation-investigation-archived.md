# Address Truncation Investigation

## Problem
Token addresses are being truncated to 20 characters when sent to the Birdeye API, causing "invalid address format" errors.

## Validation Checks Added

### 1. BirdeyeClient (`packages/api-clients/src/birdeye-client.ts`)

**Location**: `fetchOHLCVData` method (line 434)

```typescript
// CRITICAL: Verify address is not truncated before API call
if (tokenAddress.length < 32) {
  logger.error('Address is too short before API call', {
    tokenAddress,
    length: tokenAddress.length,
    expectedMin: 32,
  });
  throw new ValidationError(
    `Address is too short: ${tokenAddress.length} chars (expected >= 32)`,
    {
      addressLength: tokenAddress.length,
      expectedMin: 32,
      address: tokenAddress.substring(0, 20) + '...', // Display only
    }
  );
}
```

**Also added**:
- Debug logging with full address and length before API call (line 426-431)
- Full address logged in error messages

### 2. MarketDataBirdeyeAdapter (`packages/workflows/src/adapters/marketDataBirdeyeAdapter.ts`)

**Added debug logging** to capture full `request.tokenAddress` and its length before passing to `client.fetchOHLCVData`.

### 3. EvaluateCallsWorkflow (`packages/workflows/src/calls/evaluate.ts`)

**Added validation** to ensure `call.token.address` is not truncated before creating `TokenAddress`:
- Validation check for address length < 32
- Debug logging to capture full address and length

## Address Length Requirements

- **Solana addresses**: 32-44 characters (Base58 encoded)
- **EVM addresses**: 42 characters (0x + 40 hex characters)

The validation check (`< 32`) correctly rejects truncated Solana addresses but allows EVM addresses (42 chars).

## Logging vs. Storage

**Important**: All `.substring(0, 20)` calls found in the codebase are for **display/logging purposes only**. The actual addresses passed to API calls should be full length.

## Testing Plan

1. **Run sweep command** with a small limit to test validation:
   ```bash
   quantbot calls sweep --config sweep-config.yaml --limit 5
   ```

2. **Check logs** for:
   - "Address is too short before API call" errors
   - Full address and length in debug logs
   - Any truncation warnings

3. **Verify**:
   - Validation errors are thrown when addresses are truncated
   - Full addresses are logged in debug output
   - API calls receive full addresses

## Next Steps

1. ✅ Validation checks added
2. ⏳ Test with sweep command to identify where truncation occurs
3. ⏳ Fix truncation source once identified
4. ⏳ Add regression tests to prevent future truncation

## Files Modified

- `packages/api-clients/src/birdeye-client.ts` - Added validation and debug logging
- `packages/workflows/src/adapters/marketDataBirdeyeAdapter.ts` - Added debug logging
- `packages/workflows/src/calls/evaluate.ts` - Added validation and debug logging

