# Stub Handlers Documentation

## Overview

This document tracks CLI command handlers that are currently implemented as stubs (placeholders). These handlers are fully tested and follow the pure function pattern, but return stub/placeholder responses instead of performing actual operations.

## Stub Handlers

### Artifact Handlers

All artifact handlers are currently stubs awaiting full implementation.

#### `artifacts.list`

**Location**: `packages/cli/src/handlers/artifacts/list-artifacts.ts`

**Status**: Stub (TODO: Implement artifact listing)

**Current Behavior**:
- Returns empty array with filter parameters preserved
- Accepts filters (type, tags) but doesn't apply them yet

**Expected Future Implementation**:
- Query artifact repository from context
- Apply filters (type, tags)
- Return list of artifacts with metadata

**Tests**: ✅ Complete (3 unit tests, 2 isolation tests)

#### `artifacts.get`

**Location**: `packages/cli/src/handlers/artifacts/get-artifact.ts`

**Status**: Stub (TODO: Implement artifact retrieval)

**Current Behavior**:
- Returns `{ artifact: null, found: false }`
- Accepts ID and optional version but doesn't retrieve yet

**Expected Future Implementation**:
- Get artifact repository from context
- Fetch artifact by ID and version (or latest if version not specified)
- Return artifact content and metadata

**Tests**: ✅ Complete (3 unit tests, 2 isolation tests)

#### `artifacts.tag`

**Location**: `packages/cli/src/handlers/artifacts/tag-artifact.ts`

**Status**: Stub (TODO: Implement artifact tagging)

**Current Behavior**:
- Returns success with provided parameters
- Accepts ID, version, and tags but doesn't persist tags yet

**Expected Future Implementation**:
- Get artifact repository from context
- Add tags to artifact
- Persist tags to storage
- Return success status with updated tags

**Tests**: ✅ Complete (3 unit tests, 2 isolation tests)

## Stub Handler Pattern

All stub handlers follow the same pattern:

1. **Accept proper arguments** - Handlers accept correctly typed arguments
2. **Return structured responses** - Return proper types matching expected structure
3. **No-op behavior** - Perform no actual operations (stub responses)
4. **Fully tested** - Have comprehensive unit and isolation tests
5. **Follow pure function pattern** - No CLI dependencies, REPL-friendly

**Example Stub Pattern**:
```typescript
export async function stubHandler(args: HandlerArgs, ctx: CommandContext) {
  // TODO: Implement actual functionality
  // Get service from context
  // Perform operation
  // Return result

  // Stub response matches expected structure
  return {
    success: true,
    data: null,
    // ... other expected fields
  };
}
```

## Implementation Dependencies

These handlers depend on the artifact system being fully implemented:

1. **Artifact Repository** - Need `ArtifactRepository` interface and implementation
2. **Artifact Storage** - Need DuckDB schema for artifacts table
3. **Artifact Versioning** - Need version tracking system
4. **Artifact Tagging** - Need tagging metadata storage

## Future Implementation Checklist

When implementing artifact handlers:

- [ ] Create `ArtifactRepository` interface in `@quantbot/core`
- [ ] Implement `DuckDBArtifactAdapter` in `@quantbot/storage`
- [ ] Create DuckDB schema for artifacts table
- [ ] Add artifact repository to `CommandContext.services`
- [ ] Update handlers to use artifact repository
- [ ] Remove stub responses, implement real operations
- [ ] Update tests to verify real behavior (not stub responses)
- [ ] Add integration tests with real DuckDB

## Testing Status

All stub handlers are fully tested:

- ✅ Unit tests verify stub behavior
- ✅ Isolation tests verify REPL-friendly pattern
- ✅ Tests validate argument handling
- ✅ Tests validate response structure

**Note**: When implementing real functionality, tests will need updates to verify actual behavior instead of stub responses.

## Related Documentation

- `packages/cli/docs/MIGRATION_COMPLETE.md` - CLI migration status
- `packages/cli/docs/CLI_ARCHITECTURE.md` - Handler architecture pattern
- `packages/cli/tests/CLI_TEST_COMPLETION_SUMMARY.md` - Test completion status

