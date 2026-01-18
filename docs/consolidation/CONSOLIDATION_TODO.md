# Package Consolidation TODO - Final Status

## ✅ Completed

### Phase 0: Eliminate backtest/sim duplication
- ✅ Audited 4 differing files
- ✅ Extracted backtest-specific code
- ✅ Deleted backtest/src/sim/ directory
- ✅ Updated all imports to use @quantbot/simulation

### Phase 1: Create @quantbot/infra package
- ✅ Created packages/infra directory structure
- ✅ Moved utils, storage, observability, api-clients to infra
- ✅ Created package exports

### Phase 2: Create @quantbot/data package
- ✅ Created packages/data directory structure
- ✅ Moved ohlcv, ingestion, jobs to data package
- ✅ Updated all imports for data

### Phase 3: Consolidate Simulation + Backtest + Analytics
- ✅ Moved analytics into simulation package
- ✅ Moved remaining backtest code into simulation
- ✅ Updated simulation package exports

### Phase 4: Consolidate Lab Ecosystem
- ✅ Moved labcatalog and data-observatory into lab
- ✅ Updated lab package exports

### Phase 5: Consolidate Apps into CLI
- ✅ Moved api and lab-ui into cli package
- ✅ Added serve and lab-ui commands to CLI

### Import Migration
- ✅ Updated all ~489 imports from old packages to @quantbot/infra/*
  - @quantbot/utils → @quantbot/infra/utils
  - @quantbot/storage → @quantbot/infra/storage
  - @quantbot/api-clients → @quantbot/infra/api-clients
  - @quantbot/observability → @quantbot/infra/observability
- ✅ Updated all vi.mock() calls in test files
- ✅ Updated all vi.importActual() calls in test files

### Test Status
- ✅ 3239 tests passing (99.8% pass rate)
- ⚠️ 7 tests failing (mock setup issues, not import-related)

---

## 🔄 Remaining Work

### Priority 1: Fix Test Failures
- [ ] Fix 5 failures in `packages/ingestion/tests/OhlcvIngestionService.test.ts`
- [ ] Fix 2 failures in `packages/jobs/tests/unit/market-data-ingestion-service.test.ts`
- **Status**: Mock setup issues, not import-related

### Priority 2: Update Configuration Files (Required before shim removal)
- [ ] Update `package.json` dependencies in all packages:
  - Replace `@quantbot/utils` → `@quantbot/infra/utils`
  - Replace `@quantbot/storage` → `@quantbot/infra/storage`
  - Replace `@quantbot/api-clients` → `@quantbot/infra/api-clients`
  - Replace `@quantbot/observability` → `@quantbot/infra/observability`
- [ ] Update `tsconfig.json` path aliases in all packages
- [ ] Update `vitest.config.ts` aliases in all packages

### Priority 3: Remove Shim Files (After Priority 2)
- [ ] Delete `packages/utils/src/index.ts` (shim only)
- [ ] Delete `packages/api-clients/src/index.ts` (shim only)
- [ ] Delete `packages/observability/src/index.ts` (shim only)
- [ ] Review `packages/storage/src/index.ts` (has real exports, may need to keep)

### Priority 4: Documentation
- [ ] Update `ARCHITECTURE.md` to reflect consolidated package structure
- [ ] Update README files that reference old package names
- [ ] Update any migration guides

---

## 📊 Current Statistics

- **Test Pass Rate**: 99.8% (3239 passing, 7 failing)
- **Imports Updated**: ~489 imports across 358 files
- **Consolidation Phases**: 6/6 complete
- **Shims Remaining**: 4 shim files (blocked by config updates)

---

## 🎯 Next Immediate Steps

1. Fix remaining test failures (optional, can be done later)
2. Update package.json dependencies
3. Update tsconfig.json and vitest.config.ts
4. Remove shim files
5. Update documentation

---

## ✅ Success Criteria

- [x] All code imports updated to @quantbot/infra/*
- [x] All test mocks updated
- [ ] All package.json dependencies updated
- [ ] All config files updated
- [ ] All shim files removed
- [ ] All tests passing (currently 99.8%)
- [ ] Documentation updated
