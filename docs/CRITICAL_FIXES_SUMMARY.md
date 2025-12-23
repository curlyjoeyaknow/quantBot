# Critical Fixes Summary

This document summarizes the fixes applied to address the top 25 concrete issues identified.

## Severity 1 - MUST FIX (Lab Failures)

### ✅ Fixed: Build Artifacts Committed in src/

**Issue**: Build artifacts (`.js.map`, `.d.ts.map`) were committed in `src/` directories, causing source-of-truth confusion and nondeterministic builds.

**Fix**: 
- Removed all `.js.map` and `.d.ts.map` files from `src/` directories
- Verified `.gitignore` already properly excludes these files (`**/*.js.map`, `**/*.d.ts.map`)

**Files Changed**:
- Removed from git tracking: `packages/simulation/src/**/*.map`, `packages/ohlcv/src/**/*.map`

### ✅ Fixed: DuckDB WAL Files Committed

**Issue**: DuckDB WAL (Write-Ahead Log) files were committed to the repository, causing hidden state pollution and breaking reproducibility.

**Fix**:
- Removed all `.duckdb.wal` files from git tracking
- Verified `.gitignore` already properly excludes these files (`**/*.duckdb.wal`, `integration_test_*.duckdb.wal`)

**Files Changed**:
- Removed from git tracking: `data/test_state_*.duckdb.wal`, `integration_test_*.duckdb.wal`, `test_storage.duckdb.wal`

### ✅ Fixed: Double Validation/Coercion Pipeline

**Issue**: The same input could be interpreted differently depending on entry path due to double validation/coercion in `defineCommand.ts` and `execute.ts`.

**Fix**:
- Modified `execute()` to check if arguments already pass schema validation using `safeParse()`
- If already validated (e.g., from `defineCommand`), skip normalization/validation to prevent different interpretations
- This ensures the same input always produces the same validated output regardless of entry path

**Files Changed**:
- `packages/cli/src/core/execute.ts` - Added validation check to skip duplicate validation

### ✅ Fixed: Nondeterministic Run-ID Fallback

**Issue**: Run ID generation used `new Date().toISOString()` as fallback for missing `alertTimestamp`, causing two identical runs to generate different artifacts.

**Fix**:
- Removed nondeterministic fallback (`new Date().toISOString()`)
- Added validation that requires `alertTimestamp` (and other required fields) to be provided
- Fail fast with clear error messages if required fields are missing

**Files Changed**:
- `packages/cli/src/core/execute.ts` - `extractRunIdComponents()` now requires all fields and throws if missing

### ✅ Fixed: Object-Stringify Fallback for Candle Lookup

**Issue**: `packages/simulation/src/engine.ts` used `JSON.stringify(target)` as fallback for candle lookup, which is nondeterministic due to object property order.

**Fix**:
- Removed `JSON.stringify()` fallback
- Only use `target.mint` as lookup key (deterministic)
- Improved error message to indicate which mints are available

**Files Changed**:
- `packages/simulation/src/engine.ts` - Removed `JSON.stringify()` fallback in candle lookup

### ⚠️ TODO: ResearchSimulationAdapter is a Stub

**Issue**: `packages/workflows/src/research/simulation-adapter.ts` is currently a stub implementation that doesn't run real experiments.

**Status**: Identified but not yet implemented. This requires:
- Integration with data snapshot loading (from Branch B)
- Strategy conversion
- Execution/cost/risk model application
- Actual simulation execution

**Files to Change**:
- `packages/workflows/src/research/simulation-adapter.ts`

### ⚠️ TODO: Data Snapshot System Incomplete

**Issue**: `packages/data-observatory/src/snapshots/*` - Experiments do not have stable data inputs.

**Status**: Identified but requires implementation. The snapshot system structure exists but needs completion.

**Files to Review**:
- `packages/data-observatory/src/snapshots/snapshot-manager.ts`
- `packages/data-observatory/src/snapshots/event-collector.ts`

### ⚠️ TODO: TS Path Aliases Bypass Package Boundaries

**Issue**: `tsconfig.json` has path aliases pointing directly to `src/` directories, allowing architectural boundary bypass.

**Status**: Identified but requires refactoring. TypeScript path aliases in root and package `tsconfig.json` files point to `src/` directories instead of package public APIs.

**Recommended Fix**: 
- Update path aliases to point to package `dist/` or index files only
- Use TypeScript project references for type checking
- Ensure runtime imports go through package public APIs

**Files to Change**:
- `tsconfig.json` (root)
- `packages/*/tsconfig.json`

## Severity 2 - Will Bite at Scale

### ⚠️ TODO: Regex-Based Boundary Enforcement

**Issue**: `scripts/verify-architecture-boundaries.ts` uses regex-based enforcement which is brittle.

**Status**: Identified but not yet improved. The script works but could be more robust.

### ⚠️ TODO: Tests Excluded from Boundary Checks

**Issue**: Test code is excluded from boundary checks, allowing architecture rot to accumulate in tests.

**Status**: Identified. The boundary check script currently skips test files (`if (file.includes('.test.') || file.includes('.spec.'))`).

### ⚠️ TODO: Core Package is a Dependency Magnet

**Issue**: `packages/core/src/index.ts` exports everything, making it a dependency magnet.

**Status**: Identified but requires refactoring. Core package should be minimal and focused.

### ⚠️ TODO: Python Acting as DB Driver

**Issue**: Python scripts act as DB drivers (`packages/storage/src/duckdb/duckdb-client.ts`, `tools/storage/duckdb_artifacts.py`).

**Status**: Identified but requires architectural decision. This may be intentional for performance reasons.

### ⚠️ TODO: Silent Error Swallowing in DuckDB Adapters

**Issue**: DuckDB adapters silently swallow errors, providing false confidence in results.

**Status**: Identified but requires investigation and fixes across DuckDB adapter code.

### ⚠️ TODO: Logs Committed to Repo

**Issue**: `logs/` directory contains committed log files.

**Status**: Need to verify if logs are actually committed and remove them. `.gitignore` already excludes `logs/`.

## Severity 3 - Tech Debt Accrual

All Severity 3 issues are identified but not yet addressed. These include:
- Mixed ESM/CJS boundaries
- Public vs internal API enforcement
- Artifact handler stubs
- CLI command migration completion
- Run manifest completion
- Input fingerprinting
- CI checks for determinism and repo hygiene
- Early-abort optimization
- Floating-point determinism policy

## Next Steps

1. **Immediate Priority**: Complete ResearchSimulationAdapter implementation
2. **High Priority**: Complete data snapshot system
3. **Architecture**: Address TS path aliases and boundary enforcement improvements
4. **Quality**: Fix silent error swallowing and improve test boundary checks
5. **CI/CD**: Add checks for determinism and repo hygiene

