# Branch Merge Plan

## Current State

### Branches Created
- ✅ `staging` branch created and pushed
- ✅ Branch protection workflow added
- ✅ Documentation added

### Branch Relationships

#### Refactor Branches
- `refactor/phase2-database-query-consolidation` - Contains phases 2, 3, 4, 5 (most complete)
- `refactor/phase2-database-queries` - Phase 2 only
- `refactor/phase3-address-extraction` - Phase 3 only  
- `refactor/phase4-performance` - Phase 4 only
- `refactor/phase2-database-consolidation` - Unknown state

**Recommendation**: Use `refactor/phase2-database-query-consolidation` as it contains all phases.

#### Feature Branches
- `feature/ohlcv-gap-audit` - Already merged into integration
- `feature/ohlcv-october-backfill` - Needs review
- `feature/sim-runs-ledger` - Needs review
- `feature/october-ohlcv-backfill` - Needs review

#### Codex Branches (can PR directly to integration)
- `codex/create-shared-timeout-configuration-helper` - Already merged
- `codex/refactor-clickhouse-configuration-management` - Already merged
- `codex/add-shared-workspace-root-helper` - Needs review
- `codex/add-deterministic-simulation-tests` - Needs review

## Merge Conflicts Detected

When attempting to merge `refactor/phase2-database-query-consolidation` into `staging`, **47 files** have conflicts:

### High Priority Conflicts
- `CHANGELOG.md`
- `packages/storage/src/clickhouse-client.ts`
- `packages/storage/src/clickhouse/repositories/*.ts` (multiple repositories)
- `packages/workflows/src/context/createProductionContext.ts`
- `packages/ingestion/src/*.ts` (address validation, extraction)
- `packages/cli/src/handlers/ohlcv/*.ts`

### Test Conflicts
- Multiple test files in `packages/cli/tests/`
- `packages/ingestion/tests/`
- `packages/storage/tests/security/sql-injection.test.ts`

### Configuration Conflicts
- `pnpm-lock.yaml`
- `packages/labcatalog/package.json`
- `packages/storage/vitest.config.ts`

## Recommended Approach

### Option 1: Manual Conflict Resolution (Recommended)
1. Merge `refactor/phase2-database-query-consolidation` into `staging`
2. Resolve conflicts manually, prioritizing:
   - Integration branch changes (newer)
   - Refactor branch changes where they add new functionality
   - Test updates from both branches
3. Run full test suite after resolution
4. Merge `staging` → `integration`

### Option 2: Cherry-pick Specific Commits
If the refactor branch has specific valuable commits:
1. Identify unique commits in refactor branch
2. Cherry-pick individual commits into staging
3. Resolve conflicts per commit (smaller scope)

### Option 3: Create New Consolidation Branch
1. Create new branch from current `staging`
2. Manually apply refactor changes
3. Test thoroughly
4. Merge into staging

## Next Steps

1. **Review refactor branch changes**:
   ```bash
   git log --oneline staging..refactor/phase2-database-query-consolidation
   git diff staging..refactor/phase2-database-query-consolidation --stat
   ```

2. **Review feature branches**:
   - Check if `feature/ohlcv-october-backfill` and `feature/sim-runs-ledger` are still needed
   - Merge into staging if still relevant

3. **Review codex branches**:
   - `codex/add-shared-workspace-root-helper` - Check if already merged
   - `codex/add-deterministic-simulation-tests` - Review and merge to integration if small

4. **Clean up obsolete branches**:
   - Delete merged feature branches
   - Delete duplicate refactor branches (keep only `refactor/phase2-database-query-consolidation`)

## Commands to Execute

### Check what's unique in refactor branch
```bash
git log --oneline staging..refactor/phase2-database-query-consolidation
git diff staging..refactor/phase2-database-query-consolidation --stat
```

### Attempt merge with conflict markers
```bash
git checkout staging
git merge refactor/phase2-database-query-consolidation
# Resolve conflicts manually
git add .
git commit
```

### After staging is ready, merge to integration
```bash
git checkout integration
git merge staging
git push origin integration
```

## Notes

- The refactor branch is significantly behind integration (integration has moved forward)
- Many files have diverged, requiring careful conflict resolution
- Consider whether all refactor changes are still needed given integration's current state
- Some refactor changes may already be implemented differently in integration
