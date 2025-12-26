# Breaking Changes Refactor Plan

This document outlines the refactoring plan for the breaking changes introduced in the clock/time usage refactor.

## Breaking Changes Summary

1. **`createTelemetryConsoleAdapter()`** - `clock` parameter is now required (was optional)
2. **`calculatePnLSeries()`** - Signature changed: added optional `timestampISO` parameter
3. **`runSimPresets()`** - `RunSimPresetsSpec` now accepts optional `clock` parameter (non-breaking, but recommended)

## Refactoring Tasks

### Task 1: Update `createTelemetryConsoleAdapter()` Calls

**Impact**: Low - Only called in one place (already fixed)

**Files to Update**:
- ✅ `packages/workflows/src/context/createProductionPorts.ts` - **ALREADY FIXED**

**Status**: ✅ Complete - All calls already updated to pass `clock` parameter

**Verification**:
```bash
grep -r "createTelemetryConsoleAdapter" packages/
```
Should only show the definition and the one usage that already passes clock.

---

### Task 2: Update `calculatePnLSeries()` Calls

**Impact**: Medium - Multiple test files need updates

**Files to Update**:

#### 2.1 Production Code
- ✅ `packages/workflows/src/research/simulation-adapter.ts` - **NOW FIXED**
  - Line 160: `calculatePnLSeries(allTradeEvents, 1.0, nowISO)` - **NOW FIXED**
  - Line 202: `calculatePnLSeries([], 1.0, nowISO)` - **ALREADY FIXED**

#### 2.2 Test Files
- 🔴 `packages/workflows/tests/unit/research/metrics.test.ts` - **NEEDS UPDATE**
  - Line 12: `calculatePnLSeries([])` - Empty array, needs timestamp
  - Line 67: `calculatePnLSeries(events, 1000)` - Has events, timestamp optional
  - Line 97: `calculatePnLSeries(events)` - Has events, timestamp optional
  - Line 155: `calculatePnLSeries(events, 1000)` - Has events, timestamp optional
  - Line 208: `calculatePnLSeries(events, 1000)` - Has events, timestamp optional
  - Line 242: `calculatePnLSeries(events, 1000)` - Has events, timestamp optional
  - Line 273: `calculatePnLSeries(events, 1000)` - Has events, timestamp optional

**Update Strategy**:

For empty array calls (line 12):
```typescript
// Before
const series = calculatePnLSeries([]);

// After
const series = calculatePnLSeries([], 1.0, '2024-01-01T00:00:00.000Z');
// Or use a test helper to generate deterministic timestamp
```

For calls with events:
```typescript
// Before
const series = calculatePnLSeries(events, 1000);

// After - No change needed (timestamp optional when events exist)
// But consider adding explicit timestamp for test determinism
const series = calculatePnLSeries(events, 1000, '2024-01-01T00:00:00.000Z');
```

**Test Helper Recommendation**:
```typescript
// In test file or test helpers
const TEST_TIMESTAMP = '2024-01-01T00:00:00.000Z';

// Usage
const series = calculatePnLSeries([], 1.0, TEST_TIMESTAMP);
```

**Priority**: Medium - Tests will fail if not updated

---

### Task 3: Update `runSimPresets()` Calls (Optional but Recommended)

**Impact**: Low - This is non-breaking (clock parameter is optional), but recommended for determinism

**Files to Update**:

- 🔵 `packages/workflows/src/slices/runSimPresets.test.ts` - **OPTIONAL UPDATE**
  - Multiple calls to `runSimPresets()` (lines 42, 81, 119, 200, 247, 300, 321, 375, 434)
  - Should add `clock` to spec for deterministic tests

**Update Strategy**:

```typescript
// Before
const result = await runSimPresets({
  presets: [...],
  tokenSets: {...},
  // ... other fields
});

// After (recommended)
const mockClock = {
  nowISO: () => '2024-01-01T00:00:00.000Z',
};

const result = await runSimPresets({
  presets: [...],
  tokenSets: {...},
  clock: mockClock,
  // ... other fields
});
```

**Test Helper Recommendation**:
```typescript
// In test file
function createTestClock(initialTime: string = '2024-01-01T00:00:00.000Z') {
  return {
    nowISO: () => initialTime,
  };
}

// Usage
const result = await runSimPresets({
  ...spec,
  clock: createTestClock(),
});
```

**Priority**: Low - Optional, but improves test determinism

---

### Task 4: Update `StorageCausalCandleAccessor` Instantiation

**Impact**: Low - Only one place, already fixed

**Files to Update**:
- ✅ `packages/workflows/src/context/createProductionContext.ts` - **ALREADY FIXED**

**Status**: ✅ Complete

---

## Implementation Plan

### Phase 1: Critical Fixes (Must Do)

1. ✅ **Update `simulation-adapter.ts`** - Already fixed
2. 🔴 **Update `metrics.test.ts`** - Update all `calculatePnLSeries()` calls
   - Add timestamp for empty array calls
   - Optionally add timestamps for other calls for determinism

**Estimated Time**: 1-2 hours
**Risk**: Low - Tests only

### Phase 2: Recommended Improvements (Should Do)

1. 🔵 **Update `runSimPresets.test.ts`** - Add clock parameter to all calls
   - Improves test determinism
   - Makes tests more maintainable

**Estimated Time**: 1-2 hours
**Risk**: None - Non-breaking, optional parameter

### Phase 3: Verification (Must Do)

1. Run all tests:
   ```bash
   pnpm --filter @quantbot/workflows test
   ```

2. Verify no ESLint errors:
   ```bash
   pnpm eslint packages/workflows/src packages/workflows/tests
   ```

3. Check for any remaining violations:
   ```bash
   grep -r "Date\.now\|new Date()\|Math\.random" packages/workflows/src packages/workflows/tests
   ```

---

## Detailed File-by-File Refactoring Guide

### File: `packages/workflows/tests/unit/research/metrics.test.ts`

**Current State**:
```typescript
// Line 12
const series = calculatePnLSeries([]);

// Multiple other calls with events
const series = calculatePnLSeries(events, 1000);
```

**Required Changes**:

1. Add test helper at top of file:
```typescript
const TEST_TIMESTAMP = '2024-01-01T00:00:00.000Z';
```

2. Update empty array call (line 12):
```typescript
// Before
const series = calculatePnLSeries([]);

// After
const series = calculatePnLSeries([], 1.0, TEST_TIMESTAMP);
```

3. (Optional) Update other calls for determinism:
```typescript
// Before
const series = calculatePnLSeries(events, 1000);

// After (optional but recommended)
const series = calculatePnLSeries(events, 1000, TEST_TIMESTAMP);
```

**Test Strategy**:
- Empty array tests should verify timestamp is set correctly
- Event-based tests can remain unchanged (timestamp optional)
- Consider adding assertions to verify timestamp values

---

### File: `packages/workflows/src/slices/runSimPresets.test.ts`

**Current State**:
```typescript
const result = await runSimPresets({
  presets: [...],
  tokenSets: {...},
  // ... other required fields
  // No clock parameter
});
```

**Recommended Changes**:

1. Add test helper:
```typescript
function createTestClock(initialTime: string = '2024-01-01T00:00:00.000Z') {
  let currentTime = initialTime;
  return {
    nowISO: () => currentTime,
    // Optional: Add method to advance time for testing
    advance: (seconds: number) => {
      const dt = DateTime.fromISO(currentTime).plus({ seconds });
      currentTime = dt.toISO()!;
    },
  };
}
```

2. Update all `runSimPresets()` calls:
```typescript
const clock = createTestClock();
const result = await runSimPresets({
  presets: [...],
  tokenSets: {...},
  clock, // Add clock parameter
  // ... other fields
});
```

**Benefits**:
- Tests are deterministic
- Can control time for time-dependent test scenarios
- Easier to test edge cases with specific timestamps

---

## Migration Checklist

### Pre-Migration
- [x] Identify all breaking changes
- [x] List all affected files
- [x] Create refactoring plan
- [x] Document update strategies

### Migration
- [ ] Update `metrics.test.ts` - Fix empty array `calculatePnLSeries()` call
- [ ] (Optional) Update `metrics.test.ts` - Add timestamps to other calls
- [ ] (Optional) Update `runSimPresets.test.ts` - Add clock parameter

### Post-Migration
- [ ] Run all tests: `pnpm --filter @quantbot/workflows test`
- [ ] Verify ESLint: `pnpm eslint packages/workflows`
- [ ] Check for remaining violations: `grep -r "Date\.now\|new Date()\|Math\.random" packages/workflows`
- [ ] Update CHANGELOG.md
- [ ] Update documentation if needed

---

## Testing Strategy

### Unit Tests
- All existing tests should continue to pass
- New tests should verify deterministic behavior with clocks
- Tests with empty arrays should verify timestamp is set correctly

### Integration Tests
- Verify workflows still work with real clock
- Test that clock injection works correctly
- Verify backward compatibility where applicable

### Regression Tests
- Run full test suite
- Verify no performance regressions
- Check that determinism is maintained

---

## Rollback Plan

If issues arise:

1. **For `createTelemetryConsoleAdapter`**:
   - Make `clock` parameter optional again (with fallback to `Date.now()`)
   - This is acceptable as a temporary measure

2. **For `calculatePnLSeries`**:
   - Add default empty string for `timestampISO` parameter
   - Less ideal but maintains backward compatibility

3. **For `runSimPresets`**:
   - No rollback needed (parameter is optional)

---

## Success Criteria

- ✅ All tests pass
- ✅ No ESLint errors
- ✅ No `Date.now()`, `new Date()`, or `Math.random()` violations
- ✅ All adapters use injected clock dependencies
- ✅ Tests are deterministic and maintainable
- ✅ Documentation is updated

---

## Related Documentation

- [Date.now() Usage Policy](./date-now-usage-policy.md)
- [Workflow Clock Refactor Summary](./workflow-clock-refactor-summary.md)
- [Breaking Changes Documentation](./workflow-clock-refactor-summary.md#breaking-changes)

---

## Notes

- Most breaking changes are in test files
- Production code already updated
- Changes are straightforward (adding parameters)
- Tests will guide us if anything is missed
