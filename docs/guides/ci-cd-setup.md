# CI/CD Setup and Branch Protection

## Overview

This document describes the CI/CD workflow and how to configure branch protection rules in GitHub.

## Branch Flow

```
main (production)
  ↑ (PR from integration only)
integration (pre-production)
  ↑ (PR from staging only)
staging (development integration)
  ↑ (PR from any branch)
branches (feature/refactor/fix)
```

## Automated Workflows

### Branch Protection Workflow

**File**: `.github/workflows/branch-protection.yml`

This workflow automatically validates PR flows:
- ✅ Allows: `branches → staging`
- ✅ Allows: `codex/* → integration` (small micro branches)
- ✅ Allows: `staging/* → integration` (phase aggregates)
- ✅ Allows: `staging → integration`
- ✅ Allows: `integration → main`
- ❌ Blocks: `refactor/phase* → integration` (must go through staging first)
- ❌ Blocks: `feature/* → integration` (must go through staging)
- ❌ Blocks: `branches → main` (must go through staging → integration)

### CI Workflows

All workflows now target: `main`, `integration`, `staging`

1. **Build and Lint** (`.github/workflows/build.yml`)
   - Runs on: push and PR to main/integration/staging
   - Validates build order, architecture boundaries, linting

2. **PR Quality Gates** (`.github/workflows/pr-quality-gates.yml`)
   - Runs on: PR to main/integration/staging
   - Validates: lint, build, tests, documentation, coverage

3. **Tests** (`.github/workflows/test.yml`)
   - Runs on: push and PR to main/integration/staging
   - Runs: unit, integration, property, fuzzing tests

4. **Release Quality Gates** (`.github/workflows/release-quality-gates.yml`)
   - Runs on: release branches and manual dispatch
   - Full quality verification before release

5. **Stress Tests** (`.github/workflows/stress-tests.yml`)
   - Runs on: schedule (weekly) and manual dispatch
   - Stress and chaos engineering tests

## GitHub Branch Protection Setup

The following branch protection rules should be configured in GitHub Settings → Branches:

### 1. **main** Branch Protection

**Required Settings:**
- ✅ Require a pull request before merging
- ✅ Require approvals: 2 (or as per team policy)
- ✅ Dismiss stale pull request approvals when new commits are pushed
- ✅ Require status checks to pass before merging
  - Required checks:
    - `Build and Lint / build`
    - `PR Quality Gates / lint-and-build`
    - `PR Quality Gates / tests`
    - `PR Quality Gates / coverage-check`
    - `Branch Protection - PR Flow Enforcement / validate-pr-flow`
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings
- ✅ Restrict who can push to matching branches: (admin only)

**Branch name pattern**: `main`

**Rules for merging:**
- Only allow merge commits (not squash or rebase)
- Allow force pushes: ❌ No
- Allow deletions: ❌ No

### 2. **integration** Branch Protection

**Required Settings:**
- ✅ Require a pull request before merging
- ✅ Require approvals: 1 (or as per team policy)
- ✅ Require status checks to pass before merging
  - Required checks:
    - `Build and Lint / build`
    - `PR Quality Gates / lint-and-build`
    - `PR Quality Gates / tests`
    - `Branch Protection - PR Flow Enforcement / validate-pr-flow`
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings

**Branch name pattern**: `integration`

**Allowed PR sources** (enforced by workflow):
- ✅ `codex/*` branches (small micro branches)
- ✅ `staging/*` branches (phase aggregates)
- ✅ `staging` branch
- ❌ `refactor/phase*` branches (blocked - must go through staging first)
- ❌ Other branches (blocked - must go through staging first)

**Rules for merging:**
- Only allow merge commits
- Allow force pushes: ❌ No
- Allow deletions: ❌ No

### 3. **staging** Branch Protection

**Required Settings:**
- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Required checks:
    - `Build and Lint / build`
    - `PR Quality Gates / lint-and-build`
    - `Branch Protection - PR Flow Enforcement / validate-pr-flow`
- ✅ Require branches to be up to date before merging (optional, can be relaxed)

**Branch name pattern**: `staging`

**Rules for merging:**
- Allow merge commits, squash, or rebase (flexible)
- Allow force pushes: ⚠️ Optional (not recommended)
- Allow deletions: ❌ No

## Setting Up Branch Protection via GitHub CLI

If you have `gh` CLI installed, you can set up branch protection programmatically:

```bash
# Set up main branch protection
gh api repos/:owner/:repo/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Build and Lint / build","PR Quality Gates / lint-and-build","PR Quality Gates / tests","PR Quality Gates / coverage-check","Branch Protection - PR Flow Enforcement / validate-pr-flow"]}' \
  --field enforce_admins=true \
  --field required_pull_request_reviews='{"required_approving_review_count":2,"dismiss_stale_reviews":true}' \
  --field restrictions=null

# Set up integration branch protection
gh api repos/:owner/:repo/branches/integration/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Build and Lint / build","PR Quality Gates / lint-and-build","PR Quality Gates / tests","Branch Protection - PR Flow Enforcement / validate-pr-flow"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"dismiss_stale_reviews":true}' \
  --field restrictions=null

# Set up staging branch protection (minimal)
gh api repos/:owner/:repo/branches/staging/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["Build and Lint / build","PR Quality Gates / lint-and-build","Branch Protection - PR Flow Enforcement / validate-pr-flow"]}' \
  --field enforce_admins=false \
  --field restrictions=null
```

**Note**: Replace `:owner/:repo` with your GitHub organization and repository name.

## Manual Setup Steps

1. Go to GitHub repository → Settings → Branches
2. Click "Add rule" for each branch (main, integration, staging)
3. Configure settings as described above
4. Save each rule

## Verification

After setup, test the branch protection:

1. **Test invalid flow** (should be blocked):
   ```bash
   # Create a feature branch
   git checkout -b feature/test
   # Try to create PR directly to integration (should fail)
   ```

2. **Test valid flow** (should work):
   ```bash
   # Create PR: feature/test → staging (should work)
   # After merge, create PR: staging → integration (should work)
   # After merge, create PR: integration → main (should work)
   ```

## Troubleshooting

### Workflow Not Running

- Check that workflows are enabled in repository settings
- Verify workflow files are in `.github/workflows/`
- Check Actions tab for workflow run history

### Branch Protection Not Enforcing

- Verify branch protection rules are set in GitHub Settings
- Check that required status checks are correctly named
- Ensure workflow has run at least once (creates the check)

### PR Flow Validation Failing

- Check the workflow logs in Actions tab
- Verify PR source and target branches
- Ensure you're following the correct flow: `branches → staging → integration → main`

## Migration from Old Workflow

If migrating from `main` ↔ `develop` workflow:

1. **Create staging branch**:
   ```bash
   git checkout -b staging
   git push origin staging
   ```

2. **Rename develop to integration** (if exists):
   ```bash
   git branch -m develop integration
   git push origin integration
   git push origin --delete develop
   ```

3. **Update branch protection rules** (as described above)

4. **Update local branches**:
   ```bash
   git fetch origin
   git checkout staging
   git checkout integration
   ```

5. **Update feature branches** to target staging:
   ```bash
   git checkout feature/my-feature
   git rebase origin/staging
   ```
