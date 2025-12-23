# Core Package Dependency Magnet - Refactoring Proposal

## Problem

The `@quantbot/core` package exports everything via `export *`, making it a dependency magnet. This causes:
- All packages depend on core, even if they only need a few types
- Changes to core affect all packages (large blast radius)
- Difficult to understand what each package actually needs from core
- Circular dependency risks

## Current State

Core package exports:
- Ports & Adapters
- Commands & Handlers  
- Domain Types (CallSignal, Token, Caller, Alert, Call)
- Determinism & Reproducibility utilities
- Artifacts & Versioning
- Canonical Data schemas
- Experiment Tracking
- Simulation & Strategy Types (Candle, Strategy, SimulationEvent, etc.)
- Token & Caller Types

## Proposed Solution

Split core into focused packages:

1. **@quantbot/core-types** - Fundamental domain types only (Token, Caller, Alert, Call, Chain)
2. **@quantbot/simulation-types** - Simulation-specific types (Candle, Strategy, SimulationEvent, etc.)
3. **@quantbot/ports** - Port interfaces only
4. **@quantbot/determinism** - Determinism utilities (seed manager, etc.)
5. **@quantbot/artifacts** - Artifact schemas and manifest types
6. **@quantbot/canonical** - Canonical data schemas

This allows packages to depend only on what they need:
- `@quantbot/storage` → `@quantbot/core-types`
- `@quantbot/simulation` → `@quantbot/simulation-types`, `@quantbot/core-types`
- `@quantbot/workflows` → `@quantbot/ports`, `@quantbot/core-types`

## Alternative: Explicit Exports

Keep single core package but use explicit exports instead of `export *`:

```typescript
// Explicit exports instead of export *
export type { Token, Caller, Alert, Call } from './domain/index.js';
export type { Candle, Strategy, SimulationEvent } from './simulation/index.js';
export type { DataSnapshotRef } from './artifacts/index.js';
```

This makes dependencies clearer but still has the same blast radius issues.

## Recommendation

**Short-term**: Document current exports and add explicit export groups to make dependencies clearer.

**Long-term**: Split into focused packages as described above. This is a larger refactoring but provides better boundaries.

## Status

⚠️ **Identified but not yet refactored** - This requires careful planning to avoid breaking changes.

