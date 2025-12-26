# Execution Port Migration Guide

## Overview

This document outlines the migration path from the `ExecutionStubAdapter` to a real execution adapter for live trading.

## Current State

### ExecutionStubAdapter

The current stub adapter (`packages/workflows/src/adapters/executionStubAdapter.ts`) provides:
- ✅ Safety-first features (dry-run mode, circuit breaker, idempotency)
- ✅ Complete `ExecutionPort` interface implementation
- ✅ Deterministic behavior for testing
- ❌ No real trade execution (simulates only)

### Safety Features

The stub adapter implements critical safety features that **must be preserved** in any real adapter:

1. **Dry-Run Mode**: Prevents accidental execution
   - Default: `true` (safety-first)
   - Controlled via `EXECUTION_DRY_RUN` environment variable
   - **Never disable in development/testing**

2. **Circuit Breaker**: Stops execution after consecutive failures
   - Default: 5 consecutive failures
   - Prevents cascading failures
   - **Must be implemented in real adapter**

3. **Idempotency**: Prevents double-execution
   - Uses idempotency keys
   - Tracks executed requests
   - **Critical for production safety**

4. **Structured Error Handling**: Consistent error format
   - `ExecutionResult` with success/error fields
   - Error codes and messages
   - **Must match interface contract**

## Migration Path

### Phase 1: Real Adapter Implementation (Future)

When ready for live trading, create a new adapter:

**Location**: `packages/executor/src/adapters/executionAdapter.ts` (or similar)

**Requirements**:
1. Implement `ExecutionPort` interface from `@quantbot/core`
2. Preserve all safety features from stub:
   - Dry-run mode support
   - Circuit breaker behavior
   - Idempotency key tracking
   - Structured error handling
3. Add real execution logic:
   - Keypair/wallet management (secure storage)
   - Solana transaction building
   - Jito bundle submission (or RPC fallback)
   - Risk gates and monitoring
   - Transaction confirmation tracking

**Example Structure**:
```typescript
import type { ExecutionPort, ExecutionRequest, ExecutionResult } from '@quantbot/core';

export function createExecutionAdapter(config: {
  clock: ClockPort;
  dryRun?: boolean;
  enableIdempotency?: boolean;
  maxConsecutiveFailures?: number;
  // Real execution config
  keypairPath?: string;
  jitoEndpoint?: string;
  rpcEndpoint?: string;
}): ExecutionPort {
  // Implementation with all safety features
}
```

### Phase 2: Update createProductionPorts

Once real adapter is ready, update `createProductionPorts.ts`:

```typescript
// Option 1: Feature flag approach
const useRealExecution = process.env.USE_REAL_EXECUTION === 'true';
const execution = useRealExecution
  ? createExecutionAdapter({ clock, dryRun: process.env.EXECUTION_DRY_RUN !== 'false', ... })
  : createExecutionStubAdapter({ clock, dryRun: true, ... });

// Option 2: Environment-based selection
const executionAdapterFactory = process.env.EXECUTION_ADAPTER === 'real'
  ? createExecutionAdapter
  : createExecutionStubAdapter;
```

### Phase 3: Testing & Validation

Before switching to real execution:
1. ✅ Verify all safety features work in real adapter
2. ✅ Test with dry-run mode enabled
3. ✅ Test circuit breaker behavior
4. ✅ Test idempotency key tracking
5. ✅ Test error handling and recovery
6. ✅ Integration tests with testnet
7. ✅ Load testing and stress testing

## Implementation Checklist

### Real Execution Adapter Requirements

- [ ] Implement `ExecutionPort` interface
- [ ] Preserve dry-run mode (default: true)
- [ ] Implement circuit breaker (max failures: 5)
- [ ] Implement idempotency key tracking
- [ ] Add keypair/wallet management (secure storage)
- [ ] Add Solana transaction building
- [ ] Add Jito bundle submission
- [ ] Add RPC fallback
- [ ] Add risk gates (position limits, etc.)
- [ ] Add monitoring/telemetry
- [ ] Add transaction confirmation tracking
- [ ] Add comprehensive error handling
- [ ] Add unit tests
- [ ] Add integration tests (testnet)
- [ ] Add documentation

### Migration Steps

- [ ] Create real adapter implementation
- [ ] Add feature flag or environment variable
- [ ] Update `createProductionPorts.ts` with conditional logic
- [ ] Test with dry-run mode
- [ ] Test with testnet
- [ ] Update documentation
- [ ] Deploy with dry-run enabled
- [ ] Monitor and validate
- [ ] Gradually enable real execution

## Safety Warnings

⚠️ **CRITICAL**: Never disable safety features when migrating to real execution:

1. **Dry-Run Mode**: Always default to `true` in development/testing
2. **Circuit Breaker**: Must be implemented to prevent cascading failures
3. **Idempotency**: Critical for preventing double-execution
4. **Error Handling**: Must match stub adapter's error format
5. **Testing**: Comprehensive testing required before production use

## Current Usage

The stub adapter is used in:
- `createProductionPorts()` - Production port creation
- Workflow testing - Safe execution simulation
- Development - No real execution risk

## Related Documentation

- `packages/workflows/src/adapters/executionStubAdapter.ts` - Stub implementation
- `packages/workflows/src/context/ports.ts` - Port interfaces
- `@quantbot/core` - ExecutionPort interface definition

---

**Status**: Stub adapter is production-ready for testing/development. Real adapter implementation is deferred until live trading requirements are defined.

**Last Updated**: 2025-01-25

