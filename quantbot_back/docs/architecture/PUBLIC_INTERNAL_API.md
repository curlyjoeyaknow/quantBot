# Public vs Internal API Enforcement

## Policy

**Packages must clearly distinguish between public APIs (exported for external use) and internal APIs (implementation details).**

## Current Status

- Most packages export everything from index files
- No explicit `@internal` JSDoc tags (except one in observability)
- No enforcement mechanism

## Proposed Enforcement

### 1. JSDoc Tags

Use `@internal` tag for internal APIs:

```typescript
/**
 * Internal utility function - do not use directly
 * @internal
 */
export function internalHelper() {
  // ...
}
```

### 2. Export Restrictions

- Public APIs: Exported from package `index.ts`
- Internal APIs: Not exported from `index.ts`, or marked with `@internal`

### 3. ESLint Rule

Add ESLint rule to prevent importing `@internal` APIs from other packages:

```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          {
            "name": "@quantbot/package-name/src/internal",
            "message": "Internal API - use public API from package index instead"
          }
        ]
      }
    ]
  }
}
```

### 4. TypeScript Project References

Use TypeScript project references to enforce package boundaries (already in place).

## Migration Plan

1. **Phase 1**: Add `@internal` tags to internal functions
2. **Phase 2**: Move internal code to `src/internal/` directories
3. **Phase 3**: Update exports to exclude internal APIs
4. **Phase 4**: Add ESLint enforcement

## Priority

**SEVERITY 3** - Tech debt, not blocking. Can be addressed incrementally.
