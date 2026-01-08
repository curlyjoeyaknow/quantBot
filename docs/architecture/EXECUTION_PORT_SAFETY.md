# ExecutionPort Safety Patterns

**Status**: ⚠️ Critical Operational Details  
**Purpose**: Safety-first patterns for ExecutionPort (real money handling)  
**Related**: [Execution Port Migration Guide](./execution-port-migration.md) | [BOUNDARIES.md](../BOUNDARIES.md)

## Overview

**⚠️ CRITICAL: ExecutionPort handles real money. Always use safety-first patterns.**

ExecutionPort is the interface for trade execution. In this repository, it is **simulation-only** (stub adapter). However, the safety patterns documented here must be preserved when implementing real execution adapters in a separate executor boundary.

## Safety Features

### Dry-Run Mode (Required)

**Default behavior**: ExecutionPort is in dry-run mode by default (no real trades executed).

```typescript
// In workflow
const result = await ctx.ports.execution.execute({
  tokenAddress: createTokenAddress('...'),
  chain: 'solana',
  side: 'buy',
  amount: 0.1,
  slippageBps: 100, // 1% slippage
  priorityFee: 21_000, // µLAM per compute unit
});

// Dry-run mode returns simulated results (txSignature starts with "dry-run-")
if (result.txSignature?.startsWith('dry-run-')) {
  // This is a simulation, not a real trade
}
```

**To enable real execution** (NOT RECOMMENDED in development):

```bash
# Set environment variable (dangerous - only for production)
EXECUTION_DRY_RUN=false
```

**⚠️ WARNING**: Real execution is irreversible. Always test in dry-run mode first.

### Circuit Breaker

ExecutionPort implements a circuit breaker pattern:

- **Max consecutive failures**: 5 (configurable)
- **Circuit opens**: After max failures, all execution requests are rejected
- **Auto-reset**: Circuit resets after 60 seconds of no failures
- **Check availability**: Use `ctx.ports.execution.isAvailable()` before executing

```typescript
// Check circuit breaker before execution
const available = await ctx.ports.execution.isAvailable();
if (!available) {
  // Circuit breaker is open - do not execute
  return { success: false, error: 'Execution unavailable (circuit breaker open)' };
}

// Execute trade
const result = await ctx.ports.execution.execute(request);
```

### Idempotency Keys

ExecutionPort enforces idempotency to prevent double-execution:

- **Automatic**: Idempotency is enabled by default
- **Key generation**: Based on `tokenAddress + side + amount` (rounded)
- **Cached results**: Same request returns cached result (no duplicate execution)
- **Storage**: In-memory for stub adapter; real adapter should use `StatePort` for persistence

```typescript
// First execution
const result1 = await ctx.ports.execution.execute(request);

// Second execution (same request) - returns cached result
const result2 = await ctx.ports.execution.execute(request);

// result1.txSignature === result2.txSignature (idempotent)
```

## Best Practices

1. **Always use dry-run mode in development/testing**
   - Default behavior is dry-run (safety-first)
   - Verify execution logic without risking real money

2. **Check circuit breaker before execution**
   - Use `isAvailable()` to verify execution is healthy
   - Handle circuit breaker failures gracefully

3. **Respect idempotency**
   - Never disable idempotency checks
   - Use unique idempotency keys for different requests

4. **Monitor execution metrics**
   - Track execution success/failure rates
   - Monitor circuit breaker state
   - Log all execution attempts (even dry-run)

5. **Handle errors gracefully**
   - Execution failures should not crash workflows
   - Return structured errors with context
   - Use telemetry to track execution failures

## Example: Safe Execution in Workflow

```typescript
export async function executeTradeWorkflow(
  spec: ExecuteTradeSpec,
  ctx: WorkflowContextWithPorts
): Promise<ExecuteTradeResult> {
  // 1. Check circuit breaker
  const available = await ctx.ports.execution.isAvailable();
  if (!available) {
    ctx.ports.telemetry.emitEvent({
      name: 'execution.circuit_breaker_open',
      level: 'warn',
      message: 'Execution unavailable (circuit breaker open)',
    });
    return { success: false, error: 'Execution unavailable' };
  }

  // 2. Prepare execution request
  const request: ExecutionRequest = {
    tokenAddress: createTokenAddress(spec.tokenAddress),
    chain: spec.chain,
    side: spec.side,
    amount: spec.amount,
    slippageBps: spec.slippageBps ?? 100,
    priorityFee: spec.priorityFee ?? 21_000,
    maxRetries: 3,
  };

  // 3. Execute (dry-run by default)
  const result = await ctx.ports.execution.execute(request);

  // 4. Emit telemetry
  ctx.ports.telemetry.emitEvent({
    name: result.success ? 'execution.success' : 'execution.failed',
    level: result.success ? 'info' : 'error',
    message: result.success
      ? `Trade executed: ${result.txSignature}`
      : `Trade failed: ${result.error}`,
    context: {
      tokenAddress: spec.tokenAddress,
      side: spec.side,
      amount: spec.amount,
      dryRun: result.txSignature?.startsWith('dry-run-'),
    },
  });

  // 5. Return structured result
  return {
    success: result.success,
    txSignature: result.txSignature,
    executedPrice: result.executedPrice,
    fees: result.fees,
    error: result.error,
  };
}
```

## Related Documentation

- [Execution Port Migration Guide](./execution-port-migration.md) - Migration path from stub to real adapter
- [BOUNDARIES.md](../BOUNDARIES.md) - QuantBot boundaries policy (simulation-only)
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture overview
- `packages/workflows/src/adapters/executionStubAdapter.ts` - Stub adapter implementation
- `packages/core/src/ports/executionPort.ts` - ExecutionPort interface definition

