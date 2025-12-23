# CLI Safety Guarantees

**Status**: 📋 DOCUMENTATION  
**Priority**: High  
**Created**: 2025-01-23

## Overview

This document describes the safety guarantees provided by the CLI system, ensuring deterministic, traceable, and safe operation.

## Safety Guarantees

### 1. Single Coercion/Validation Path

**Guarantee**: All CLI arguments pass through a single, unified validation and coercion pipeline.

**Implementation**:
- All commands use `validateAndCoerceArgs()` from `validation-pipeline.ts`
- No handler can bypass validation
- Consistent type coercion across all commands

**Benefits**:
- Predictable behavior
- Consistent error messages
- Single point of validation logic maintenance

**Example**:
```typescript
// ✅ CORRECT: Use unified pipeline
const args = validateAndCoerceArgs(commandDef.schema, rawOptions);

// ❌ WRONG: Bypass pipeline
const args = commandDef.schema.parse(rawOptions);
```

### 2. Deterministic Run-ID Handling

**Guarantee**: Run IDs are generated deterministically from command components. Same inputs always produce the same run ID.

**Implementation**:
- `generateRunId()` uses SHA-256 hash of components
- Components validated before generation
- Run ID structure: `{command}_{strategyId}_{mint_short}_{timestamp}_{hash8}[_{suffix}]`

**Benefits**:
- Reproducible runs
- Traceable execution
- Artifact organization

**Example**:
```typescript
const components: RunIdComponents = {
  command: 'simulation.run-duckdb',
  strategyId: 'PT2',
  mint: 'So11111111111111111111111111111111111111112',
  alertTimestamp: '2024-01-01T12:00:00Z',
};

// Always generates same ID for same components
const runId = generateRunId(components);
// Result: simulation_run_duckdb_PT2_So11111_20240101120000_a3f2b1c9
```

**Validation**:
- Components validated before generation
- Run ID structure validated after generation
- Determinism verified (generates twice, compares)

### 3. AST-Based Boundary Enforcement

**Guarantee**: Package boundaries are enforced at build time using AST analysis, not just regex.

**Implementation**:
- `verify-boundaries-ast.ts` uses TypeScript compiler API
- Parses source files into AST
- Detects forbidden imports at AST level

**Benefits**:
- More accurate than regex
- Catches edge cases
- Prevents architectural drift

**Forbidden Patterns**:
- Workflows cannot import from CLI/TUI
- Workflows cannot import storage implementations
- CLI handlers cannot import workflow internals
- No deep imports from @quantbot packages

**Example**:
```typescript
// ❌ FORBIDDEN: Workflow importing CLI
import { something } from '@quantbot/cli';

// ❌ FORBIDDEN: Deep import
import { something } from '@quantbot/storage/src/postgres';

// ✅ CORRECT: Public API import
import { something } from '@quantbot/storage';
```

### 4. CI Hygiene Checks

**Guarantee**: Repository state is validated in CI to prevent common issues.

**Checks**:
- No build artifacts in source directories
- No runtime state files (DuckDB WAL, test databases)
- No forbidden files in root
- Package.json hygiene

**Benefits**:
- Prevents "works on my machine" issues
- Ensures clean builds
- Maintains repository hygiene

**Example Violations**:
```
❌ packages/cli/src/something.js.map (build artifact in src/)
❌ integration_test_123.duckdb.wal (runtime state file)
❌ TEST_SUMMARY.md (should be in docs/)
```

## Enforcement

### Build Time

- AST-based boundary checks run in CI
- Hygiene checks run in CI
- TypeScript compilation enforces types

### Runtime

- Validation pipeline validates all arguments
- Run ID validation ensures determinism
- Error contracts capture failures

### Development

- ESLint rules enforce boundaries
- Pre-commit hooks (optional) can run checks
- Code review checklist verifies compliance

## Testing

### Unit Tests

- `validation-pipeline.test.ts` - Tests unified validation
- `run-id-validator.test.ts` - Tests run ID determinism

### Integration Tests

- Boundary enforcement tests verify no violations
- CI runs all checks automatically

## Related Documentation

- [CLI Architecture](./CLI_ARCHITECTURE.md) - Overall CLI architecture
- [Handler Pattern](./HANDLER_PATTERN_VERIFICATION.md) - Handler requirements
- [Workflow Enforcement](../../../docs/WORKFLOW_ENFORCEMENT.md) - Workflow boundaries

## Maintenance

### Adding New Validation

1. Add to `validation-pipeline.ts`
2. Update schema in command definition
3. Add tests

### Adding New Boundary Rules

1. Update `verify-boundaries-ast.ts`
2. Add to ESLint config
3. Update documentation

### Adding New Hygiene Checks

1. Add to `hygiene-checks.ts`
2. Update CI workflow
3. Document in this file

