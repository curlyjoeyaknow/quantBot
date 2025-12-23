# AGENT C — CLI, BOUNDARIES & HYGIENE - Deliverables

**Status**: ✅ COMPLETE  
**Created**: 2025-01-23

## Overview

AGENT C is responsible for making the system safe to operate through:
- Single coercion/validation path
- Deterministic run-id handling
- AST-based boundary enforcement
- CI hygiene checks

## Deliverables

### ✅ 1. Single Coercion/Validation Path

**File**: `packages/cli/src/core/validation-pipeline.ts`

**Implementation**:
- Created unified `validateAndCoerceArgs()` function
- All CLI arguments pass through this single path
- Combines normalization and validation in one step

**Changes**:
- Updated `execute.ts` to use unified pipeline
- Removed direct calls to `normalizeOptions()` and `parseArguments()`
- All commands now use `validateAndCoerceArgs()`

**Tests**: `packages/cli/tests/unit/core/validation-pipeline.test.ts`

### ✅ 2. Deterministic Run-ID Handling

**Files**:
- `packages/cli/src/core/run-id-validator.ts` - Validation utilities
- `packages/cli/src/core/run-id-manager.ts` - Generation (existing, enhanced)

**Implementation**:
- `validateRunIdComponents()` - Validates components before generation
- `verifyRunIdDeterminism()` - Ensures same inputs produce same ID
- `validateRunId()` - Validates generated run ID structure
- `generateAndValidateRunId()` - Convenience function

**Changes**:
- Updated `execute.ts` to validate run IDs before use
- Added comprehensive validation checks
- Ensures determinism is verified

**Tests**: `packages/cli/tests/unit/core/run-id-validator.test.ts`

### ✅ 3. AST-Based Boundary Enforcement

**File**: `scripts/ci/verify-boundaries-ast.ts`

**Implementation**:
- Uses TypeScript compiler API to parse source files
- Extracts import statements from AST
- Detects forbidden imports more accurately than regex

**Features**:
- Detects workflow → CLI/TUI imports
- Detects workflow → storage implementation imports
- Detects CLI handler → workflow internals imports
- Detects deep imports from @quantbot packages

**Integration**:
- Added to `package.json` as `verify:boundaries-ast`
- Added to CI workflow (`.github/workflows/build.yml`)

### ✅ 4. CI Hygiene Checks

**File**: `scripts/ci/hygiene-checks.ts`

**Implementation**:
- Checks for build artifacts in source directories
- Checks for runtime state files (DuckDB WAL, test databases)
- Checks for forbidden files in root
- Validates package.json hygiene

**Integration**:
- Added to `package.json` as `check:hygiene`
- Added to CI workflow (`.github/workflows/build.yml`)

## CI Integration

### Build Workflow Updates

**File**: `.github/workflows/build.yml`

**Added Steps**:
1. Verify architecture boundaries (AST)
2. CI hygiene checks

**Order**:
1. Verify build order
2. Verify workflow contracts
3. **Verify architecture boundaries (AST)** ← NEW
4. **CI hygiene checks** ← NEW
5. Build packages (ordered)
6. Type check
7. Lint

## Testing

### Unit Tests

- `packages/cli/tests/unit/core/validation-pipeline.test.ts` - Validation pipeline tests
- `packages/cli/tests/unit/core/run-id-validator.test.ts` - Run ID validation tests

### Integration Tests

- AST boundary checks run in CI
- Hygiene checks run in CI

## Documentation

### New Documentation

- `packages/cli/docs/CLI_SAFETY_GUARANTEES.md` - Comprehensive safety guarantees documentation

### Updated Documentation

- `packages/cli/docs/CLI_ARCHITECTURE.md` - References unified validation pipeline

## Scripts Added

### NPM Scripts

```json
{
  "verify:boundaries-ast": "tsx scripts/ci/verify-boundaries-ast.ts",
  "check:hygiene": "tsx scripts/ci/hygiene-checks.ts"
}
```

### CI Scripts

- `scripts/ci/verify-boundaries-ast.ts` - AST-based boundary enforcement
- `scripts/ci/hygiene-checks.ts` - Repository hygiene checks

## Safety Guarantees

### 1. Single Validation Path

✅ All CLI arguments pass through `validateAndCoerceArgs()`
✅ No handler can bypass validation
✅ Consistent type coercion

### 2. Deterministic Run IDs

✅ Run IDs generated deterministically
✅ Components validated before generation
✅ Run ID structure validated after generation
✅ Determinism verified (generates twice, compares)

### 3. Boundary Enforcement

✅ AST-based detection (more accurate than regex)
✅ Forbidden imports caught at build time
✅ CI fails on violations

### 4. Repository Hygiene

✅ Build artifacts detected
✅ Runtime state files detected
✅ Forbidden root files detected
✅ CI fails on violations

## Usage

### Local Development

```bash
# Run boundary checks
pnpm verify:boundaries-ast

# Run hygiene checks
pnpm check:hygiene

# Run all safety checks
pnpm verify:boundaries-ast && pnpm check:hygiene
```

### CI

All checks run automatically in CI:
- Boundary checks run before build
- Hygiene checks run before build
- Build fails if any check fails

## Future Enhancements

### Potential Improvements

1. **Pre-commit hooks**: Run checks before commit (optional)
2. **Incremental checks**: Only check changed files
3. **Boundary visualization**: Generate dependency graph
4. **Run ID deduplication**: Detect duplicate run IDs

### Monitoring

- Track boundary violations over time
- Track hygiene violations over time
- Alert on new violation patterns

## Related Work

- [CLI Architecture](./packages/cli/docs/CLI_ARCHITECTURE.md)
- [Workflow Enforcement](./WORKFLOW_ENFORCEMENT.md)
- [Architecture Boundaries](./ARCHITECTURE_BOUNDARIES.md)

