# TypeScript Path Aliases Refactoring Plan

## Current State

TypeScript path aliases in `tsconfig.json` point directly to `src/` directories:

```json
{
  "paths": {
    "@quantbot/utils": ["./packages/utils/src"],
    "@quantbot/utils/*": ["./packages/utils/src/*"],
    // ... etc
  }
}
```

**Problem**: This allows deep imports that bypass package boundaries:
- `@quantbot/storage/src/postgres/repo.ts` - bypasses package exports
- `@quantbot/utils/src/logger.ts` - bypasses package index

## Proposed Solution

### Option 1: Point to Package Index Only

```json
{
  "paths": {
    "@quantbot/utils": ["./packages/utils/src/index.ts"],
    "@quantbot/storage": ["./packages/storage/src/index.ts"],
    // Remove wildcard patterns (*)
  }
}
```

**Pros**: Enforces package boundaries strictly
**Cons**: Requires updating all imports, breaks deep imports

### Option 2: Use TypeScript Project References Only

Remove path aliases entirely, rely on TypeScript project references:

```json
{
  "references": [
    { "path": "./packages/utils" },
    { "path": "./packages/storage" },
    // ...
  ]
}
```

**Pros**: Most correct, enforces boundaries
**Cons**: Requires updating all imports, more complex setup

### Option 3: Hybrid Approach

- Keep path aliases for package root only (no wildcards)
- Use project references for build ordering
- ESLint rule to prevent deep imports

```json
{
  "paths": {
    "@quantbot/utils": ["./packages/utils"],
    "@quantbot/storage": ["./packages/storage"],
    // No wildcards - forces use of package exports
  }
}
```

## Migration Strategy

1. **Phase 1**: Update ESLint to catch deep imports (already in place)
2. **Phase 2**: Update path aliases to remove wildcards
3. **Phase 3**: Update imports incrementally
4. **Phase 4**: Remove path aliases, use project references only

## Enforcement

- ESLint rule: `no-restricted-imports` (already catches deep imports)
- AST boundary checker: Verifies no cross-package deep imports
- TypeScript project references: Enforce build order

## Priority

**SEVERITY 3** - Tech debt. Current enforcement (ESLint + AST checker) is sufficient for now.

The path aliases are convenient for development. The real enforcement is through:
- ESLint rules (catch violations)
- AST boundary checker (CI enforcement)
- Code review (human oversight)

