# Branching Strategy and CI/CD Workflow

## Branch Hierarchy

The repository follows a strict branching strategy with the following hierarchy:

```
main (production)
  ↑
integration (accepts PRs from codex/*, staging/*, staging)
  ↑
staging (accepts PRs from any branch, including refactor/phase*)
  ↑
branches (feature/refactor/hotfix branches)
```

## Branch Flow Rules

### 1. **main** (Production)
- **Purpose**: Production-ready code
- **Accepts PRs from**: `integration` only
- **Protection**: Highest level of quality gates
- **Deployment**: Automatically deployed to production

### 2. **integration** (Pre-Production)
- **Purpose**: Integration testing and final validation
- **Accepts PRs from**:
  - ✅ `codex/*` branches (small micro branches)
  - ✅ `staging/*` branches (phase aggregates)
  - ✅ `staging` branch
- **Does NOT accept PRs from**:
  - ❌ `refactor/phase*` branches (must go through staging first)
  - ❌ Other feature/refactor branches (must go through staging first)
- **Protection**: Full test suite, quality gates
- **Note**: Enforced by workflow - only specific branch patterns allowed

### 3. **staging** (Development Integration)
- **Purpose**: Integration of multiple features and phase refactors
- **Accepts PRs from**: Any branch (feature/refactor/hotfix)
  - ✅ `refactor/phase*` branches (must go through staging before integration)
  - ✅ `feature/*` branches
  - ✅ `fix/*` branches
  - ✅ All other branch types
- **Protection**: Standard quality gates
- **Note**: This is where feature branches and phase refactors merge together

### 4. **branches** (Feature Development)
- **Purpose**: Individual feature development
- **Naming**: `feature/*`, `refactor/*`, `fix/*`, `hotfix/*`
- **Target**: Always PR to `staging`
- **Lifecycle**: Delete after merge to staging

## Special Branch Rules

### Codex Branches (Micro Branches)
- **Pattern**: `codex/*`
- **Purpose**: Small, focused changes (typically AI-generated)
- **Direct to Integration**: ✅ Can PR directly to `integration`
- **Bypasses**: Staging (small changes don't need staging integration)
- **Example**: `codex/create-shared-timeout-configuration-helper`

### Staging Phase Branches
- **Pattern**: `staging/*`
- **Purpose**: Phase aggregates that have been tested in staging
- **Direct to Integration**: ✅ Can PR directly to `integration`
- **Use case**: Aggregated phase work ready for integration testing
- **Example**: `staging/phase2-consolidation`

### Refactor Phase Branches (Restricted)
- **Pattern**: `refactor/phase*`
- **Purpose**: Large refactoring work organized by phases
- **Direct to Integration**: ❌ **NOT ALLOWED** - must go through staging first
- **Required Flow**: `refactor/phase* → staging → integration`
- **Reason**: Phase refactors are large and need staging integration before integration branch
- **Example**: `refactor/phase2-database-queries`, `refactor/phase3-address-extraction`

## PR Workflow

### Standard Feature Development

1. **Create feature branch** from `staging`:
   ```bash
   git checkout staging
   git pull origin staging
   git checkout -b feature/my-feature
   ```

2. **Develop and commit**:
   ```bash
   # Make changes, commit
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Create PR to staging**:
   ```bash
   git push origin feature/my-feature
   # Create PR: feature/my-feature → staging
   ```

4. **After merge to staging**, create PR to integration:
   ```bash
   # After staging PR is merged
   git checkout staging
   git pull origin staging
   git checkout -b pr/integration
   git push origin pr/integration
   # Create PR: staging → integration
   ```

5. **After merge to integration**, create PR to main:
   ```bash
   # After integration PR is merged
   git checkout integration
   git pull origin integration
   git checkout -b pr/main
   git push origin pr/main
   # Create PR: integration → main
   ```

### Codex Branch Workflow (Direct to Integration)

For small, focused changes:

1. **Create codex branch** from `integration`:
   ```bash
   git checkout integration
   git pull origin integration
   git checkout -b codex/my-small-change
   ```

2. **Make small, focused changes**:
   ```bash
   # Make small changes, commit
   git add .
   git commit -m "codex: add small helper"
   ```

3. **Create PR directly to integration**:
   ```bash
   git push origin codex/my-small-change
   # Create PR: codex/my-small-change → integration (allowed!)
   ```

### Refactor Phase Branch Workflow (Must Go Through Staging)

For large phase refactors:

1. **Create refactor branch** from `staging`:
   ```bash
   git checkout staging
   git pull origin staging
   git checkout -b refactor/phase2-database-queries
   ```

2. **Develop phase refactor**:
   ```bash
   # Make changes, commit
   git add .
   git commit -m "refactor: phase 2 database query consolidation"
   ```

3. **Create PR to staging** (required):
   ```bash
   git push origin refactor/phase2-database-queries
   # Create PR: refactor/phase2-database-queries → staging
   ```

4. **After merge to staging**, create PR to integration:
   ```bash
   # After staging PR is merged
   git checkout staging
   git pull origin staging
   git checkout -b pr/integration
   git push origin pr/integration
   # Create PR: staging → integration
   ```

**Note**: Attempting to PR `refactor/phase*` directly to `integration` will be blocked by the workflow.

### Automated Enforcement

The CI/CD system automatically enforces these rules:

- **Branch Protection Workflow** (`.github/workflows/branch-protection.yml`):
  - Validates PR source and target branches
  - Blocks invalid PR flows:
    - ❌ Blocks: `refactor/phase*` → `integration` (must go through staging)
    - ❌ Blocks: `feature/*` → `integration` (must go through staging)
    - ✅ Allows: `codex/*` → `integration` (small micro branches)
    - ✅ Allows: `staging/*` → `integration` (phase aggregates)
    - ✅ Allows: `staging` → `integration`
  - Enforces: `branches → staging → integration → main` (with exceptions for codex/* and staging/*)

## CI/CD Pipeline

### Workflows by Branch

#### All Branches (staging, integration, main)
- **Build and Lint** (`.github/workflows/build.yml`)
- **Tests** (`.github/workflows/test.yml`)
- **PR Quality Gates** (`.github/workflows/pr-quality-gates.yml`)

#### Integration and Main
- **Release Quality Gates** (`.github/workflows/release-quality-gates.yml`)
- **Stress Tests** (`.github/workflows/stress-tests.yml`)

### Quality Gates

Each branch level has increasing quality requirements:

1. **staging**: Basic quality gates
   - Lint and build
   - Unit tests
   - Integration tests (optional)
   - Documentation checks (warn only)

2. **integration**: Enhanced quality gates
   - All staging gates
   - Full test suite (required)
   - Coverage requirements
   - Documentation required
   - Architecture boundary checks

3. **main**: Production quality gates
   - All integration gates
   - Stress tests
   - Release verification
   - Breaking change documentation
   - Full coverage verification

## Branch Naming Conventions

### Feature Branches
- `feature/description` - New features
- Example: `feature/ohlcv-gap-audit`
- **Target**: Always PR to `staging` first

### Codex Branches (Micro Branches)
- `codex/description` - Small, focused changes (AI-generated)
- Example: `codex/create-shared-timeout-configuration-helper`
- **Target**: Can PR directly to `integration` (bypasses staging)
- **Use case**: Small, isolated changes that don't need staging integration

### Staging Phase Branches
- `staging/description` - Phase aggregates ready for integration
- Example: `staging/phase2-consolidation`
- **Target**: Can PR directly to `integration`
- **Use case**: Aggregated phase work that's been tested in staging

### Refactor Branches
- `refactor/description` - Code refactoring
- Example: `refactor/phase2-database-queries`
- **Important**: `refactor/phase*` branches must PR to `staging` first, then `staging` → `integration`
- **Never**: `refactor/phase*` branches should NOT PR directly to `integration`

### Fix Branches
- `fix/description` - Bug fixes
- Example: `fix/clickhouse-timeout-handling`

### Hotfix Branches
- `hotfix/description` - Critical production fixes
- Example: `hotfix/security-patch`

## Merging Strategy

### Merge Commits
- Use merge commits (not squash) to preserve history
- Each merge should have a clear message

### Fast-Forward Prevention
- Branches are protected from fast-forward merges
- Ensures merge commits are created

## Emergency Procedures

### Hotfix to Production

For critical production issues:

1. Create hotfix branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/critical-fix
   ```

2. Fix and test locally

3. Create PR: `hotfix/critical-fix → main`
   - Requires admin approval
   - Bypasses normal flow

4. After merge to main, backport to integration and staging:
   ```bash
   git checkout integration
   git cherry-pick <hotfix-commit>
   git push origin integration
   
   git checkout staging
   git cherry-pick <hotfix-commit>
   git push origin staging
   ```

## Best Practices

1. **Always start from staging**: Create feature branches from `staging`
2. **Keep branches small**: One feature per branch
3. **Regular updates**: Rebase feature branches on staging regularly
4. **Delete merged branches**: Clean up after merge
5. **Follow naming conventions**: Use prefixes (feature/, refactor/, fix/)
6. **Write clear PR descriptions**: Explain what and why
7. **Update CHANGELOG**: Document changes appropriately

## Troubleshooting

### PR Rejected: Invalid Branch Flow

**Error**: "refactor/phase* branches cannot PR directly to integration"

**Solution**: 
1. PR your `refactor/phase*` branch → staging
2. After merge, PR staging → integration

**Error**: "integration branch only accepts PRs from codex/*, staging/*, or staging"

**Solution**: 
- If it's a `codex/*` branch, ensure the branch name starts with `codex/`
- If it's a `staging/*` branch, ensure the branch name starts with `staging/`
- Otherwise, create an intermediate PR:
  1. PR your branch → staging
  2. After merge, PR staging → integration

### Branch Behind

If your branch is behind the target:

```bash
git checkout your-branch
git fetch origin
git rebase origin/staging  # or integration/main
```

### Conflicts

Resolve conflicts during rebase:
```bash
# Fix conflicts
git add .
git rebase --continue
```

## Migration Notes

This branching strategy replaces the previous `main` ↔ `develop` model:

- **Old**: `main` ↔ `develop` ↔ `branches`
- **New**: `main` ← `integration` ← `staging` ← `branches`

The new model provides:
- Clearer separation of concerns
- Enforced quality gates at each level
- Better integration testing before production
- Explicit staging environment for feature integration
