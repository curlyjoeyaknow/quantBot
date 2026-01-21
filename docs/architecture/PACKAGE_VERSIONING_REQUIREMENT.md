# Package Versioning Requirement

## ⚠️ CRITICAL: All Packages Must Be Versioned

**Every package in the monorepo MUST have a valid semantic version number.**

This is a **non-negotiable requirement** for maintaining code quality, tracking changes, and ensuring reproducible builds.

## Why Versioning Matters

1. **Change Tracking**: Versions provide a clear audit trail of when packages changed
2. **Dependency Management**: Other packages can specify exact versions they depend on
3. **Release Management**: Versions enable proper release notes and changelog generation
4. **CI/CD Verification**: Automated checks ensure version bumps accompany code changes
5. **Reproducibility**: Specific versions enable reproducible builds and deployments

## Requirements

### 1. All Packages Must Have Versions

**Every `package.json` file MUST include a `version` field:**

```json
{
  "name": "@quantbot/package-name",
  "version": "1.0.0",  // ← REQUIRED
  ...
}
```

**This applies to:**
- ✅ Public packages
- ✅ Private packages (`"private": true`)
- ✅ Internal-only packages
- ✅ Experimental packages

**No exceptions.**

### 2. Version Format

All versions MUST follow [Semantic Versioning (Semver)](https://semver.org/):

- **MAJOR.MINOR.PATCH** format (e.g., `1.0.0`, `2.1.3`)
- **No pre-release versions** in committed code (e.g., no `1.0.0-alpha.1`)
- **No `0.0.0`** - This indicates an unversioned package and is not allowed

### 3. Version Bump Requirements

**Every code change that affects a package MUST bump that package's version:**

- **PATCH** (`x.y.Z`): Bug fixes, typo corrections, internal refactoring
- **MINOR** (`x.Y.z`): New features, new exports, backward-compatible additions
- **MAJOR** (`X.y.z`): Breaking changes, removed APIs, incompatible changes

**Exceptions (no version bump needed):**
- Only documentation files changed (`*.md`, `docs/**`)
- Only test files changed (`*.test.ts`, `tests/**`)
- Only configuration files changed (`*.config.ts`, `tsconfig.json`)

### 4. Pre-Commit Verification

**Before committing, verify:**

```bash
# Check all packages have versions
pnpm verify:package-versions

# This will fail if:
# - Any package is missing a version field
# - Any package has version "0.0.0"
# - Changed packages don't have version bumps
```

### 5. CI/CD Enforcement

The CI pipeline automatically:

- ✅ Verifies all packages have valid semver versions
- ✅ Checks that changed packages have version bumps
- ✅ Prevents version regressions (versions don't decrease)
- ⚠️ Warns about duplicate versions (informational)

**PRs will be blocked if versioning requirements are not met.**

## Current Package Versions

All packages should be at version `1.0.0` or higher:

- `@quantbot/analytics`: 1.0.0
- `@quantbot/api-clients`: 1.0.0
- `@quantbot/api`: 1.0.0
- `@quantbot/backtest`: 1.0.0
- `@quantbot/cli`: 1.0.0
- `@quantbot/core`: 1.0.0
- `@quantbot/data`: 1.0.0
- `@quantbot/data-observatory`: 1.0.0
- `@quantbot/infra`: 1.0.0
- `@quantbot/ingestion`: 1.0.0
- `@quantbot/jobs`: 1.0.0
- `@quantbot/lab`: 1.0.0
- `@quantbot/lab-ui`: 1.0.0
- `@quantbot/labcatalog`: 1.0.0
- `@quantbot/observability`: 1.0.0
- `@quantbot/ohlcv`: 1.0.0
- `@quantbot/simulation`: 2.0.0 (intentional - major version)
- `@quantbot/storage`: 1.0.0
- `@quantbot/utils`: 1.0.0
- `@quantbot/workflows`: 1.0.0

## How to Bump Versions

### Manual Bump

1. Edit `packages/{package}/package.json`
2. Update the `version` field
3. Update `CHANGELOG.md` (see [CHANGELOG Enforcement](../.cursor/rules/changelog-enforcement.mdc))

### Automated Bump

Use the version bump script:

```bash
# Bump patch version (bug fixes)
pnpm version:bump @quantbot/utils patch

# Bump minor version (new features)
pnpm version:bump @quantbot/utils minor

# Bump major version (breaking changes)
pnpm version:bump @quantbot/utils major
```

The script automatically:
- Updates `package.json`
- Adds entry to `CHANGELOG.md`
- Validates the version format

## Release Process

**Before each release:**

1. Audit all package versions:
   ```bash
   pnpm release:audit-versions
   ```

2. Generate version summary for release notes

3. Ensure all version changes are documented in:
   - `CHANGELOG.md` (per-package)
   - Release notes (summary of all changes)

## Enforcement

### Pre-Commit Hook

The pre-commit hook runs `pnpm verify:package-versions` and will:
- ❌ **Block commits** if packages are missing versions
- ❌ **Block commits** if changed packages don't have version bumps
- ⚠️ **Warn** about potential issues

### CI Pipeline

The CI pipeline runs the same verification and:
- ❌ **Fails the build** if versioning requirements are not met
- ✅ **Allows the build** only when all packages are properly versioned

## Common Issues

### Issue: "Package missing version"

**Error**: `Package @quantbot/package-name is missing version field`

**Fix**: Add `"version": "1.0.0"` to the package's `package.json`

### Issue: "Package has version 0.0.0"

**Error**: `Package @quantbot/package-name has invalid version: 0.0.0`

**Fix**: Update to `"version": "1.0.0"` or appropriate version

### Issue: "Changed package without version bump"

**Error**: `Package @quantbot/package-name was changed but version not bumped`

**Fix**: Bump the package version according to the type of change (patch/minor/major)

## Related Documentation

- [CONTRIBUTING.md](../../CONTRIBUTING.md#package-versioning) - Full versioning policy
- [CHANGELOG Enforcement](../.cursor/rules/changelog-enforcement.mdc) - Changelog requirements
- [Semantic Versioning](https://semver.org/) - Official Semver specification

## Summary

**Remember:**
- ✅ Every package MUST have a version
- ✅ Every code change MUST bump the version
- ✅ Versions MUST follow semver format
- ✅ CI/CD enforces these requirements
- ❌ No exceptions, no `0.0.0`, no missing versions

**This is a matter of importance for code quality and maintainability.**

