# Architecture Boundaries Implementation

This document summarizes the implementation of architecture boundary enforcement as requested.

## Completed Tasks

### 1. ✅ Deep Imports Enforcement (Warn → Error)

**Location**: `eslint.config.mjs`

Changed the `no-restricted-imports` rule from `'warn'` to `'error'` for deep imports from `@quantbot/*/src/**`.

**Impact**: Deep imports are now blocked at build time, making boundaries physical rather than aspirational.

**Exception**: Test files are excluded (line 133 in eslint.config.mjs).

### 2. ✅ New Ports Created

**Location**: `packages/core/src/ports/`

Created four new port interfaces:

- **MarketDataPort** (`marketDataPort.ts`)
  - For market data providers (Birdeye, Helius, Shyft, etc.)
  - Methods: `fetchOhlcv()`, `fetchMetadata()`, `fetchHistoricalPriceAtTime()`

- **ExecutionPort** (`executionPort.ts`)
  - For trade execution (Jito bundles, RPC send, etc.)
  - Methods: `execute()`, `isAvailable()`

- **StatePort** (`statePort.ts`)
  - For state storage (Redis, SQL databases, etc.)
  - Methods: `get()`, `set()`, `delete()`, `query()`, `transaction()`, `isAvailable()`

- **TelemetryPort** (`telemetryPort.ts`)
  - For structured metrics and events
  - Methods: `emitMetric()`, `emitEvent()`, `startSpan()`, `endSpan()`, `emitSpan()`

All ports are exported from `packages/core/src/ports/index.ts` and available via `@quantbot/core`.

### 3. ⚠️ WorkflowContext Refactoring (Documented as Next Step)

**Status**: Documented for future implementation

The WorkflowContext currently contains raw clients. The next step is to refactor it to use ports instead:

- `repos.*` → Use `StatePort` for storage operations
- `ohlcv.*` → Use `MarketDataPort` for market data
- Direct client access → Replace with port adapters

This is a larger refactoring that will require:
1. Creating adapters for each port (in `packages/api-clients`, `packages/storage`, etc.)
2. Updating `createProductionContext()` to wire port adapters
3. Updating all workflows to use ports instead of raw clients

**Recommendation**: Do this incrementally, starting with one workflow and one port type.

### 4. ✅ Architecture Tests Created

**Location**: `scripts/verify-architecture-boundaries.ts`

Created two structural tests:

**A) Forbidden Imports Test**
- Verifies handlers in `packages/core/src/handlers/**` only import from:
  - `@quantbot/core` (public API)
  - Relative imports within the same package
  - Standard library modules
- Fails if handlers import from other `@quantbot` packages

**B) Public API Enforcement Test**
- Verifies no code uses deep imports (`@quantbot/*/src/**`)
- Only `@quantbot/<pkg>` (public API) should be used
- Test files are excluded from this check

**Usage**: Run `pnpm verify:architecture-boundaries` (added to `package.json`)

### 5. ✅ Command Conversion: validate-addresses

**Pure Handler**: `packages/cli/src/handlers/ingestion/validate-addresses.ts`
- Pure function: no I/O, no env, no console.log
- Takes validated args and context
- Returns structured result

**Composition Root**: `packages/cli/src/commands/ingestion/validate-addresses.ts`
- Wires adapters
- Calls pure handler
- Handles presentation (formatting)

### 6. ✅ Command Conversion: run-simulation-duckdb

**Pure Handler**: `packages/cli/src/handlers/simulation/run-simulation-duckdb.ts`
- Pure function: no I/O, no env, no console.log
- Takes validated args and context
- Calls workflow via context
- Returns structured result

**Composition Root**: `packages/cli/src/commands/simulation/run-simulation-duckdb.ts`
- Reads `process.env` for configuration
- Wires adapters (OhlcvFetchJob, workflow context)
- Calls pure handler
- Handles presentation (formatting)

## Naming Consistency

**Established Pattern**:
- **"handlers"** = Pure functions (in `packages/cli/src/handlers/`)
- **"commands"** = Composition roots / app adapters (in `packages/cli/src/commands/`)

This consistency becomes a cognitive shortcut for developers.

## Next Steps

1. **Fix Deep Import Violations**: Run the architecture test and fix any existing deep imports:
   ```bash
   pnpm verify:architecture-boundaries
   ```

2. **Create Port Adapters**: Implement adapters for the new ports:
   - `MarketDataPort` adapter wrapping BirdeyeClient/HeliusClient
   - `ExecutionPort` adapter wrapping Jito/RPC clients
   - `StatePort` adapter wrapping Redis/SQL clients
   - `TelemetryPort` adapter wrapping logger/metrics systems

3. **Refactor WorkflowContext**: Gradually migrate workflows to use ports instead of raw clients.

4. **Convert More Commands**: Continue converting commands to pure handlers following the established pattern.

## Files Changed

- `eslint.config.mjs` - Deep imports now error
- `packages/core/src/ports/marketDataPort.ts` - New port
- `packages/core/src/ports/executionPort.ts` - New port
- `packages/core/src/ports/statePort.ts` - New port
- `packages/core/src/ports/telemetryPort.ts` - New port
- `packages/core/src/ports/index.ts` - Export new ports
- `scripts/verify-architecture-boundaries.ts` - Architecture tests
- `package.json` - Added `verify:architecture-boundaries` script
- `packages/cli/src/handlers/ingestion/validate-addresses.ts` - Pure handler
- `packages/cli/src/handlers/simulation/run-simulation-duckdb.ts` - Pure handler
- `packages/cli/src/commands/ingestion/validate-addresses.ts` - Composition root
- `packages/cli/src/commands/simulation/run-simulation-duckdb.ts` - Composition root

## Testing

Run the architecture boundary tests:
```bash
pnpm verify:architecture-boundaries
```

Run ESLint to catch deep imports:
```bash
pnpm lint
```

