# Ports Migration Status

## Overview

This document tracks the migration of workflows from direct client imports to ports-based architecture.

## Migration Checklist

### ✅ Completed

- **OHLCV Ingestion Workflow** (`packages/workflows/src/ohlcv/ingestOhlcv.ts`)
  - Uses `ctx.ports.marketData.fetchOhlcv()` for candles
  - Uses `ctx.ports.state.get/set()` for idempotency
  - Uses `ctx.ports.telemetry.emitEvent/emitMetric()` for observability
  - No direct `@quantbot/api-clients` imports
  - No direct `@quantbot/storage/src/**` imports

### ✅ Completed (Recently Migrated)

- **resolveEvmChains.ts** (`packages/workflows/src/metadata/resolveEvmChains.ts`)
  - ✅ Uses `ctx.ports.marketData.fetchMetadata()` for chain resolution
  - ✅ Uses `ctx.ports.state.get/set()` for idempotency caching
  - ✅ Uses `ctx.ports.telemetry.emitEvent/emitMetric()` for observability
  - ✅ No direct `@quantbot/api-clients` imports
  - ✅ Accepts `WorkflowContextWithPorts`

### 🚧 In Progress (Expected Lint Errors)

- **ingestTelegramJson.ts** (`packages/workflows/src/telegram/ingestTelegramJson.ts`)
  - Still uses direct `@quantbot/api-clients` imports
  - **Next to migrate**: May need new IngestionPort or TelegramPort

## Architecture Enforcement

### ESLint Rules

- ✅ Workflows cannot import from `@quantbot/api-clients` (enforced)
- ✅ Workflows cannot import from `@quantbot/storage/src/**` (enforced)
- ✅ Context/adapters directories are exceptions (composition roots)

### CI Gates

- ✅ `pnpm verify:architecture-boundaries` - passes
- ⚠️ `scripts/ci-architecture.sh` - shows expected errors for unported workflows
- ✅ `pnpm smoke:ports` - validates all port adapters

## Port Adapters

### Implemented

- ✅ **MarketDataPort**: `createMarketDataBirdeyeAdapter()` - wraps BirdeyeClient
- ✅ **StatePort**: `createStateDuckdbAdapter()` - DuckDB-backed persistent state
- ✅ **TelemetryPort**: `createTelemetryConsoleAdapter()` - console output
- ✅ **ClockPort**: System clock (uses Date.now())

### Stubs (Not Yet Implemented)

- ⏳ **ExecutionPort**: Throws "not wired yet" error

## Migration Pattern

For each workflow migration:

1. **Define/extend port** if needed (in `@quantbot/core/src/ports/`)
2. **Build adapter** in `packages/workflows/src/adapters/`
3. **Update workflow** to use `ctx.ports.*`
4. **Delete direct imports** from workflow file
5. **Add telemetry** events/metrics
6. **Update tests** to use stubbed ports

## Next Steps

1. ✅ Port `resolveEvmChains.ts` workflow (COMPLETED)
2. Port `ingestTelegramJson.ts` workflow
3. Remove ESLint quarantine override (after ingestTelegramJson is ported)
4. Add workflow template generator
5. Implement TelemetryPort real sink (OTEL/Prometheus)
6. Build replay harness v1

## Testing

Run smoke test:
```bash
pnpm smoke:ports
```

This validates:
- MarketDataPort (fetch metadata, OHLCV, historical price)
- StatePort (get, set, delete, isAvailable)
- TelemetryPort (emitEvent, emitMetric, startSpan/endSpan)
- ClockPort (nowMs)

