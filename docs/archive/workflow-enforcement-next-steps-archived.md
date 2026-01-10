# Workflow Enforcement - Next Steps

## Overview

The workflow rules have been updated and marked as `alwaysApply: true`. This document outlines the concrete next steps to implement the enforcement mechanisms described in the rules.

## Current Status

### ✅ Completed
- Workflow rules updated with all recommendations
- Rules marked as `alwaysApply: true`
- Architecture layers documented
- Enforcement trio documented

### ✅ Completed
- **ESLint boundaries for workflows**: Added rules preventing imports from CLI/TUI and storage implementations
- **ESLint boundaries for CLI handlers**: Added rules preventing imports from workflow internals

### ⚠️ Partially Implemented
- **Test harness**: `createMockContext` exists but uses different naming/pattern than rule suggests (acceptable - already clear from context)

### ❌ Not Implemented
- Workflow contract compliance verification script
- Pre-commit hooks for workflow contract checks (optional - can be CI-only)

## Next Steps

### 1. ✅ Add ESLint Boundaries for Workflows Package (COMPLETED)

**File**: `eslint.config.mjs`

Add a new configuration block to prevent workflows from importing forbidden dependencies:

```typescript
{
  files: ['packages/workflows/src/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: '@quantbot/cli',
          message: 'Workflows cannot depend on CLI. Use WorkflowContext for all dependencies.'
        },
        {
          name: '@quantbot/tui',
          message: 'Workflows cannot depend on TUI. Use WorkflowContext for all dependencies.'
        },
        {
          name: '@quantbot/storage/src/postgres',
          message: 'Use WorkflowContext repos, not direct Postgres imports'
        },
        {
          name: '@quantbot/storage/src/clickhouse',
          message: 'Use WorkflowContext repos, not direct ClickHouse imports'
        },
        {
          name: '@quantbot/storage/src/duckdb',
          message: 'Use WorkflowContext repos, not direct DuckDB imports'
        },
      ],
      patterns: [
        {
          group: ['@quantbot/cli*', '@quantbot/tui*'],
          message: 'Workflows cannot import from CLI or TUI packages'
        },
        {
          group: ['@quantbot/storage/src/**/postgres*', '@quantbot/storage/src/**/clickhouse*'],
          message: 'Workflows must use WorkflowContext, not direct storage implementation imports'
        },
      ],
    }],
  },
},
```

**Status**: ✅ **COMPLETED** - Added to `eslint.config.mjs` on 2025-01-XX

### 2. ✅ Add ESLint Boundaries for CLI Handlers (COMPLETED)

**File**: `eslint.config.mjs`

Add a new configuration block to prevent CLI handlers from importing workflow internals:

```typescript
{
  files: ['packages/cli/src/handlers/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: '@quantbot/workflows/src',
          message: 'CLI handlers can only import from @quantbot/workflows public API (index.ts)'
        },
      ],
      patterns: [
        {
          group: ['@quantbot/workflows/src/**'],
          message: 'CLI handlers cannot import workflow internals. Use public API only.'
        },
      ],
    }],
  },
},
```

**Status**: ✅ **COMPLETED** - Added to `eslint.config.mjs` on 2025-01-XX

### 3. Standardize Mock Context Factory

**File**: `packages/workflows/tests/helpers/mockContext.ts`

The existing `createMockContext` is good but should be aligned with the rule's suggested pattern. Consider:

1. **Option A**: Rename to `createMockWorkflowContext` and update all usages
2. **Option B**: Keep `createMockContext` but add `createMockWorkflowContext` as an alias
3. **Option C**: Keep current name (it's already clear from context)

**Recommendation**: Option C (keep current name) - it's already clear and widely used. The rule's example is just a pattern suggestion.

**Action**: Review and document the current pattern, ensure it matches the rule's intent

### 4. Create Workflow Contract Compliance Verification Script

**File**: `scripts/verify-workflow-contract.ts`

Create a script that verifies:
- Workflow signatures use default parameter pattern
- Workflow results are JSON-serializable (Zod schema validation)
- No forbidden imports in workflows
- CLI handlers don't contain orchestration logic

**Example structure**:
```typescript
#!/usr/bin/env tsx

import { readFileSync } from 'fs';
import { glob } from 'glob';

interface WorkflowContractViolation {
  file: string;
  line: number;
  violation: string;
  severity: 'error' | 'warning';
}

async function verifyWorkflowContracts(): Promise<void> {
  const violations: WorkflowContractViolation[] = [];
  
  // 1. Check workflow signatures
  const workflowFiles = await glob('packages/workflows/src/**/*.ts');
  for (const file of workflowFiles) {
    // Check for default parameter pattern
    // Check for JSON-serializable result types
  }
  
  // 2. Check CLI handlers
  const handlerFiles = await glob('packages/cli/src/handlers/**/*.ts');
  for (const file of handlerFiles) {
    // Check for orchestration logic (loops, multi-step flows)
  }
  
  // 3. Report violations
  if (violations.length > 0) {
    console.error('Workflow contract violations found:');
    violations.forEach(v => {
      console.error(`  ${v.file}:${v.line} - ${v.violation}`);
    });
    process.exit(1);
  }
}

verifyWorkflowContracts();
```

**Action**: Create this script (can be simple AST parsing or regex-based initially)

### 5. Add Workflow Contract Checks to CI

**File**: `.github/workflows/build.yml` or new workflow file

Add a step to run the verification script:

```yaml
- name: Verify Workflow Contracts
  run: pnpm tsx scripts/verify-workflow-contract.ts
```

**Action**: Add this step to CI workflow

### 6. Optional: Pre-Commit Hook for Workflow Contracts

**File**: `.husky/pre-commit`

Add workflow contract verification (optional - can be CI-only for speed):

```bash
# Verify workflow contracts (fast check)
echo "🔍 Verifying workflow contracts..."
pnpm tsx scripts/verify-workflow-contract.ts || {
  echo "❌ Workflow contract verification failed"
  exit 1
}
```

**Action**: Optional - add if verification is fast enough (< 1 second)

## Implementation Priority

1. **High Priority** (Enforces architecture immediately):
   - ✅ ESLint boundaries for workflows (Step 1)
   - ✅ ESLint boundaries for CLI handlers (Step 2)

2. **Medium Priority** (Improves developer experience):
   - ✅ Standardize mock context factory (Step 3)
   - ✅ Create verification script (Step 4)

3. **Low Priority** (Nice to have):
   - ✅ Add to CI (Step 5)
   - ✅ Add to pre-commit (Step 6)

## Testing the Enforcement

After implementing ESLint boundaries:

1. Try importing `@quantbot/cli` in a workflow file - should error
2. Try importing `@quantbot/storage/src/postgres` in a workflow file - should error
3. Try importing `@quantbot/workflows/src/types` in a CLI handler - should error

## Notes

- ESLint boundaries are the most important enforcement mechanism (catches violations at write-time)
- The verification script can be simple initially (regex-based) and improved later (AST-based)
- Pre-commit hooks should be fast - if verification is slow, keep it CI-only
- The mock context factory is already good - just needs documentation alignment

## Related Files

- `.cursor/rules/packages-workflows.mdc` - The workflow rules
- `eslint.config.mjs` - ESLint configuration
- `packages/workflows/tests/helpers/mockContext.ts` - Mock context factory
- `.husky/pre-commit` - Pre-commit hooks

