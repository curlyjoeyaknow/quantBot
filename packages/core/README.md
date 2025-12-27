# @quantbot/core

> Core types and interfaces for QuantBot - foundational package with zero dependencies on other @quantbot packages

## Overview

`@quantbot/core` is the foundation package that defines:

- **Domain Types**: `Candle`, `Chain`, `Token`, `Call`, `Alert`, `Strategy`, etc.
- **Port Interfaces**: `ClockPort`, `TelemetryPort`, `MarketDataPort`, `ExecutionPort`, `StatePort`
- **Handler Contracts**: Handler interfaces and command types
- **Causal Candle Accessor**: `CausalCandleAccessor` interface for Gate 2 compliance

## Architecture

This package has **zero dependencies** on other `@quantbot` packages, making it the foundation for the entire monorepo.

### Dependencies

- `luxon` - Date/time handling

### No Dependencies On

- ❌ `@quantbot/utils`
- ❌ `@quantbot/storage`
- ❌ Any other `@quantbot/*` package

This ensures `@quantbot/core` can be imported by any package without circular dependency risks.

## Key Exports

### Domain Types

```typescript
import type { Candle, Chain, Token, Call, Alert, Strategy } from '@quantbot/core';
```

### Port Interfaces

```typescript
import type {
  ClockPort,
  TelemetryPort,
  MarketDataPort,
  ExecutionPort,
  StatePort,
} from '@quantbot/core';
```

### Causal Candle Accessor

```typescript
import type { CausalCandleAccessor } from '@quantbot/core';
```

## Usage

### Importing Types

```typescript
import type { Candle, Chain, Token } from '@quantbot/core';

const candle: Candle = {
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  volume: 1000,
  timestamp: DateTime.now(),
};
```

### Using Port Interfaces

```typescript
import type { ClockPort } from '@quantbot/core';

function myHandler(clock: ClockPort) {
  const now = clock.nowMs();
  // ...
}
```

## Build Order

This package must be built **first** (position 1) in the build order:

```bash
pnpm --filter @quantbot/core build
```

## Related Documentation

- [ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) - System architecture
- [WORKFLOWS.md](../../docs/architecture/WORKFLOWS.md) - Workflow documentation

