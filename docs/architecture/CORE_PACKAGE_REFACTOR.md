# Core Package Refactoring Plan

## Current State

The `@quantbot/core` package currently exports:
- Ports & Adapters interfaces
- Commands & Handlers types
- Core domain types (Calls, Tokens, Alerts, Strategies)
- Simulation types (Candles, Events, Results)
- Artifacts & Run Manifests
- Determinism utilities
- Chain utilities
- Strategy DSL

**Issue**: Every package depends on `@quantbot/core`, making it a dependency magnet that defeats the purpose of layering.

## Proposed Refactoring

Split `@quantbot/core` into focused packages:

1. **@quantbot/types** - Pure type definitions (no logic)
   - Domain types (Call, Token, Alert, Strategy)
   - Simulation types (Candle, Event, Result)
   - Chain types
   - Zero dependencies

2. **@quantbot/ports** - Port interfaces only
   - ExecutionPort
   - StoragePort
   - DataPort
   - Zero dependencies

3. **@quantbot/domain** - Domain logic and utilities
   - Determinism utilities
   - Seed management
   - Hashing functions
   - Depends on: @quantbot/types

4. **@quantbot/artifacts** - Artifact and manifest system
   - RunManifest
   - Artifact schemas
   - Depends on: @quantbot/types, @quantbot/domain

5. **@quantbot/strategy** - Strategy DSL and validation
   - DSL schema
   - DSL validator
   - DSL to simulation input converter
   - Depends on: @quantbot/types

## Migration Strategy

1. **Phase 1**: Create new packages alongside existing `@quantbot/core`
2. **Phase 2**: Update imports incrementally (package by package)
3. **Phase 3**: Deprecate `@quantbot/core` exports
4. **Phase 4**: Remove `@quantbot/core` (or keep as re-export package for backward compatibility)

## Priority

**SEVERITY 2** - Will bite you at scale, but not blocking current work.

The current structure is acceptable for now, but should be refactored when:
- Codebase grows beyond current size
- Circular dependency issues arise
- Package boundaries become unclear
- Build times become problematic

## Enforcement

Until refactored, maintain discipline:
- Keep `@quantbot/core` dependency-free (no dependencies on other @quantbot packages)
- Document what belongs in core vs. what should be extracted
- Review new exports to core carefully

