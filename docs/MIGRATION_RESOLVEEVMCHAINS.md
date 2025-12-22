# Migration: resolveEvmChains.ts

## Status: ✅ COMPLETED

The `resolveEvmChains.ts` workflow has been fully migrated to use ports-based architecture.

## Changes Made

### Ports Integration
- ✅ Replaced `BirdeyeClient` with `ctx.ports.marketData.fetchMetadata()`
- ✅ Added `ctx.ports.state.get/set()` for idempotency caching
- ✅ Added `ctx.ports.telemetry.emitEvent/emitMetric()` for observability
- ✅ Uses `ctx.ports.clock.nowMs()` for timestamps

### Context Migration
- ✅ Changed from `ResolveEvmChainsContext` to `WorkflowContextWithPorts`
- ✅ Removed direct `BirdeyeClient` dependency
- ✅ Updated `createDefaultResolveEvmChainsContext()` to use `createProductionContextWithPorts()`

### Idempotency
- ✅ Added state caching: `evm_chain_resolution:<address>`
- ✅ Skips already-resolved tokens (30-day TTL)
- ✅ Prevents duplicate API calls

### Telemetry
- ✅ `evm_chain_resolution_started` event
- ✅ `evm_chain_resolved` event (per token)
- ✅ `evm_chain_resolution_completed` event
- ✅ Metrics: `evm_chain_resolution_tokens_*`, `evm_chain_resolution_duration_ms`

## Verification

- ✅ No `@quantbot/api-clients` imports
- ✅ No direct HTTP client imports
- ✅ Accepts `WorkflowContextWithPorts`
- ✅ All lint checks pass
- ✅ Architecture boundaries verified

## Testing

The workflow can now be tested with stubbed ports:

```typescript
const mockCtx = {
  ports: {
    marketData: {
      fetchMetadata: vi.fn().mockResolvedValue({ symbol: 'TEST', name: 'Test Token' }),
    },
    state: {
      get: vi.fn().mockResolvedValue({ found: false }),
      set: vi.fn().mockResolvedValue({ success: true }),
    },
    telemetry: {
      emitEvent: vi.fn(),
      emitMetric: vi.fn(),
    },
    clock: {
      nowMs: () => Date.now(),
    },
  },
  logger: { /* ... */ },
};

await resolveEvmChains(spec, mockCtx);
```

## Next Steps

1. Port `ingestTelegramJson.ts` workflow
2. Remove ESLint quarantine override
3. Add unit tests with stubbed ports

