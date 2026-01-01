# PR Closure Instructions

## Summary

All 4 codex PRs have been merged into the `integration` branch. However, they were targeting `main` instead of `integration`, so they need to be manually closed on GitHub.

## What Was Done

✅ **Merged to integration:**
- `codex/add-deterministic-simulation-tests` → integration
- `codex/create-shared-timeout-configuration-helper-ean0hn` → integration  
- `codex/create-shared-timeout-configuration-helper-fuq030` → integration
- `codex/refactor-clickhouse-configuration-management` → integration (was already merged)

## PRs to Close Manually

### PR #16: Add seeded determinism tests
**Status**: ✅ Merged to integration  
**Action**: Close with comment:
```
Merged into integration branch. This codex branch was merged directly to integration per our workflow (codex/* → integration).
```

### PR #17: Centralize ClickHouse config defaults  
**Status**: ✅ Already in integration (commit 3e51125e)  
**Action**: Close with comment:
```
Already merged into integration branch (commit 3e51125e). This PR targets main but changes are already in integration.
```

### PR #23: Harden ClickHouse timeout (fuq030)
**Status**: ✅ Merged to integration  
**Action**: Close with comment:
```
Merged into integration branch. This codex branch was merged directly to integration per our workflow (codex/* → integration).
```

### PR #24: Harden ClickHouse timeout (ean0hn)
**Status**: ✅ Merged to integration  
**Action**: Close with comment:
```
Merged into integration branch. This codex branch was merged directly to integration per our workflow (codex/* → integration).
```

## How to Close PRs

1. Go to each PR on GitHub
2. Click "Close pull request"
3. Add the comment above
4. Confirm closure

Or use GitHub CLI (if you have permissions):
```bash
gh pr close 16 --comment "Merged into integration branch. This codex branch was merged directly to integration per our workflow (codex/* → integration)."
gh pr close 17 --comment "Already merged into integration branch (commit 3e51125e). This PR targets main but changes are already in integration."
gh pr close 23 --comment "Merged into integration branch. This codex branch was merged directly to integration per our workflow (codex/* → integration)."
gh pr close 24 --comment "Merged into integration branch. This codex branch was merged directly to integration per our workflow (codex/* → integration)."
```

## Current State

- ✅ All codex branches merged to integration
- ✅ Integration branch is up to date
- ⏳ 4 PRs need manual closure (they target main but were merged to integration)

## Next Steps

1. Close the 4 PRs manually on GitHub
2. When ready, create PR: `integration → main` for production release
3. Continue using the workflow: `branches → staging → integration → main`
