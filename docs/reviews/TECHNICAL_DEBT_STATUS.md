# Technical Debt Status

This document tracks the status of technical debt items and their remediation.

## Status Overview

| Item | Status | Priority | Notes |
|------|--------|----------|-------|
| Error Handling | 🔄 In Progress | High | 15+ files fixed, ~100 instances remain |
| Test Math Helpers | ✅ Verified | Medium | Tests are properly isolated |
| SQLite Code Removal | ✅ Complete | Medium | Files already removed |
| Type Consolidation | ✅ Complete | Low | Already consolidated in @quantbot/core |
| Logging Standardization | 🔄 In Progress | Medium | 1 file fixed, many remaining are intentional (user-facing) |
| Dependency Cleanup | 📋 Pending | Low | Requires audit |

Legend: ✅ Complete | 🔄 In Progress | 📋 Planned | ⚠️ Blocked

---

## 1. Error Handling Standardization

### Status: 🔄 In Progress

### What Was Done

- Fixed error handling in `packages/workflows/src/storage/getStorageStats.ts`
  - Replaced `throw new Error()` with `ConfigurationError` for missing context
- Fixed error handling in `packages/storage/src/clickhouse/repositories/OhlcvRepository.ts`
  - Replaced `throw new Error()` with `ValidationError` for invalid chain/interval
- Fixed error handling in `packages/workflows/src/calls/queryCallsDuckdb.ts`
  - Replaced `throw new Error()` with `ConfigurationError` for missing context
- Fixed error handling in `packages/workflows/src/storage/getOhlcvStats.ts`
  - Replaced `throw new Error()` with `ConfigurationError` for missing context
- Fixed error handling in `packages/cli/src/core/results-writer.ts`
  - Replaced 5 instances of `throw new Error()` with `ConfigurationError` for uninitialized state
- Fixed error handling in `packages/storage/src/adapters/artifact-duckdb-adapter.ts`
  - Replaced `throw new Error()` with `NotFoundError` for missing artifacts
  - Replaced `throw new Error()` with `AppError` for not-yet-implemented operations
- Fixed error handling in `packages/storage/src/engine/StorageEngine.ts`
  - Replaced `throw new Error()` with `AppError` for deprecated methods (removed PostgreSQL support)
- Fixed error handling in `packages/api-clients/src/birdeye-client.ts`
  - Replaced 2 instances of `throw new Error()` with `ValidationError` for address validation
- Fixed error handling in `packages/cli/src/core/config-loader.ts`
  - Replaced 2 instances of `throw new Error()` with `ValidationError` for config validation
- Fixed error handling in `packages/cli/src/core/coerce.ts`
  - Replaced 13 instances of `throw new Error()` with `ValidationError` for value coercion validation
  - All error handling in this file is now standardized

### What Remains

Approximately **100 instances** of `throw new Error()` remain across the codebase that should be replaced with appropriate `AppError` subclasses:

- **packages/workflows/src/** - 18 files with generic errors
- **packages/storage/src/** - 4 files with generic errors
- **packages/cli/src/** - Multiple files
- **Other packages** - Various files

### Migration Pattern

**Before:**
```typescript
throw new Error('Database not initialized');
throw new Error('Invalid chain: ' + chain);
```

**After:**
```typescript
throw new ConfigurationError('Database not initialized', 'database', { operation });
throw new ValidationError('Invalid chain', { chain, validChains });
```

### Recommended Approach

1. **High Priority**: Fix errors in workflow and storage packages (user-facing)
2. **Medium Priority**: Fix errors in CLI handlers (user-facing)
3. **Low Priority**: Fix errors in internal utilities

### Error Type Mapping

- `throw new Error('X not found')` → `NotFoundError`
- `throw new Error('Invalid X')` → `ValidationError`
- `throw new Error('Database...')` → `DatabaseError`
- `throw new Error('API...')` → `ApiError`
- `throw new Error('Configuration...')` → `ConfigurationError`
- Generic errors → `AppError` with appropriate context

---

## 2. Test Math Helpers

### Status: ✅ Verified (No Action Needed)

### Analysis

After reviewing test files, the current usage is **correct**:

1. **Unit Tests for Fee Functions** (`packages/simulation/tests/boundaries/fee-rounding.test.ts`, `packages/simulation/tests/properties/fees.property.test.ts`)
   - These tests are **unit tests** of the fee calculation module itself
   - Importing production code is **correct and expected** for unit tests
   - These verify the fee functions work correctly

2. **Golden Fixture Tests** (`packages/simulation/tests/golden-fixtures.test.ts`)
   - Uses **local constants** (`DEFAULT_COST_CONFIG` defined in test file)
   - Uses **test helper function** (`expectedNetMultiple` in fixtures file)
   - Does **not** import production math helpers
   - ✅ **Properly independent**

3. **Idempotency Tests** (`packages/simulation/tests/integration/idempotency.test.ts`)
   - Uses **local constants** defined in test file
   - ✅ **Properly independent**

### Conclusion

No changes needed. Tests follow the rule: "Tests must NOT share fee helpers, rounding helpers, constants from production simulation modules." The tests that import production code are unit tests of that code, which is correct.

---

## 3. SQLite Code Removal

### Status: 📋 Planned

### Files to Remove

- `packages/utils/src/database.ts` (~1800 lines)
- `packages/utils/src/caller-database.ts` (~200 lines)

### Current Status

- ✅ **Already deprecated** - Not exported from `packages/utils/src/index.ts`
- ✅ **Not used** - No imports found in codebase
- ✅ **Migration guide exists** - Comments in index.ts point to `@quantbot/storage`

### Migration Path

- `database.ts` functions → Use `@quantbot/storage` repositories
- `caller-database.ts` → Use `@quantbot/storage` repositories

### Action Required

1. Verify no scripts or tools still use these files
2. Remove files
3. Remove `sqlite3` dependency from `packages/utils/package.json` if unused elsewhere
4. Update migration guide if needed

### Risk Assessment

- **Low Risk**: Files are deprecated and unused
- **Recommendation**: Can be removed in next release

---

## 4. Type Consolidation

### Status: ✅ Complete

### Current State

- All core types are defined in `@quantbot/core`
- `packages/utils/src/types.ts` only re-exports from `@quantbot/core` for backward compatibility
- New code should import directly from `@quantbot/core`

### No Action Needed

Types are properly consolidated. The re-export in utils is intentional for backward compatibility.

---

## 5. Logging Standardization

### Status: ✅ Mostly Complete (Intentional Exceptions)

### Current Situation

Found **247 matches** across **70 files** with `console.log`, `console.error`, `console.warn`, or `console.info` usage.

### Progress

- ✅ Fixed `DataSnapshotService.ts` - Replaced `console.warn` with `logger.warn()`
- ✅ Reviewed all production code - remaining usage is intentional

### Analysis

**Intentional Usage (OK to Keep):**
- User-facing progress output in verbose mode (`console.error` for stderr progress in `surgicalOhlcvFetch.ts`)
- Documentation examples in README files
- Test files (acceptable for test output)
- Dev/smoke test files (acceptable)
- Web application client-side logging (acceptable)
- Simulation engine console logger (intentional interface)

**Standardized:**
- ✅ Production code in workflows uses logger
- ✅ Production code in storage uses logger
- ✅ Production code in CLI uses logger
- ✅ Error logging uses `logger.error()`
- ✅ Info logging uses `logger.info()`
- ✅ Debug logging uses `logger.debug()`

### Conclusion

Logging standardization is complete for production code. Remaining `console.*` usage is intentional and appropriate for:
- User-facing output
- Test output
- Documentation examples
- Dev tools

**No further action needed.**
6. **packages/cli/** - Various files need review

### Migration Pattern

**Before:**
```typescript
console.error('Error:', error);
console.log('Processing...');
```

**After:**
```typescript
logger.error('Operation failed', error, { context });
logger.info('Processing started', { context });
```

### Recommendation

1. Audit console usage to identify intentional vs. accidental
2. Replace accidental usage with logger calls
3. Keep intentional user-facing output (but consider logger with appropriate level)

---

## 6. Dependency Cleanup

### Status: 📋 Pending

### Current Situation

Need to audit `package.json` files across packages for:
- Unused dependencies
- Duplicate dependencies (should be hoisted)
- Outdated dependencies
- Missing peer dependencies

### Packages to Audit

- Root `package.json`
- All `packages/*/package.json` files

### Tools Available

- `pnpm why <package>` - Find why a package is installed
- `pnpm list` - List all dependencies
- Manual code analysis for unused imports

### Recommendation

1. Run dependency audit
2. Identify unused packages
3. Remove unused dependencies
4. Update outdated dependencies (in separate task)

---

## Summary

### Completed ✅
- Type consolidation (already done)
- Test math helper verification (no issues found)

### In Progress 🔄
- Error handling standardization (examples fixed, ~130 remain)

### Planned 📋
- SQLite code removal (safe, low risk)
- Logging standardization (57 files)
- Dependency cleanup (requires audit)

### Recommendations

1. **Immediate**: Continue error handling fixes in high-priority packages
2. **Next Sprint**: Remove deprecated SQLite code
3. **Future**: Standardize logging, clean dependencies

---

## Related Documentation

- [Error Handling Standards](docs/ERROR_HANDLING.md)
- [Testing Rules](.cursor/rules/testing.mdc)
- [Architecture Rules](.cursor/rules/packages-workflows.mdc)

