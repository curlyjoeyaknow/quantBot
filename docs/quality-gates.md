# Quality Gates

This document describes the quality gates and enforcement mechanisms for QuantBot.

## Overview

Quality gates ensure code quality, test coverage, and documentation standards are maintained across all PRs and releases. All quality gate checks must pass before code can be merged or released.

## Quality Gate Checks

### Per PR

The following checks are enforced on every pull request:

- ✅ **Unit tests** - All new functions must have unit tests
- ✅ **Property tests** - Financial calculations must have property tests
- ✅ **Handler tests** - CLI command handlers must have tests
- ✅ **Documentation updates** - Documentation must be updated when code changes
- ✅ **CHANGELOG entry** - Functional changes must be documented in CHANGELOG.md
- ✅ **No forbidden imports** - Architecture boundaries must be respected
- ✅ **Build passes** - All packages must build successfully

### Per Release

The following additional checks are enforced before release:

- ✅ **All tests pass** - Unit, integration, property, fuzzing, and e2e tests
- ✅ **Coverage doesn't decrease** - Code coverage must meet or exceed baseline
- ✅ **Stress tests pass** - Database stress tests and chaos engineering tests
- ✅ **Documentation reviewed** - All documentation must be up to date
- ✅ **Breaking changes documented** - Migration guides must exist for breaking changes

## Verification Scripts

### Handler Test Verification

**Script**: `scripts/ci/verify-handler-tests.ts`  
**Command**: `pnpm verify:handler-tests`

Verifies that all CLI handlers have corresponding test files and follow the handler contract:

- Handlers must not use: `console.log`, `process.exit`, `try/catch`, output formatting
- Tests must verify: parameter conversion, error propagation, service calls
- Handlers must be REPL-friendly (can be called with plain objects)

### Property Test Verification

**Script**: `scripts/ci/verify-property-tests.ts`  
**Command**: `pnpm verify:property-tests`

Verifies that financial calculations have property tests:

- Detects functions matching financial patterns (calculatePnL, calculateFee, slippage, etc.)
- Checks for corresponding property tests in `packages/**/tests/properties/**/*.test.ts`
- Ensures financial invariants are tested (monotonicity, bounds, conservation laws)

### CHANGELOG Verification

**Script**: `scripts/ci/verify-changelog.ts`  
**Command**: `pnpm verify:changelog`

Verifies that CHANGELOG.md is updated for functional changes:

- Analyzes git diff for functional changes (features, bug fixes, breaking changes)
- Checks for `[Unreleased]` section with relevant entries
- Validates Keep a Changelog format
- Verifies severity indicators for security/bug fixes

### Documentation Verification

**Script**: `scripts/ci/verify-documentation.ts`  
**Command**: `pnpm verify:documentation`

Verifies that documentation is updated when code changes:

- Checks for `DOCS:` comments in changed files
- Verifies referenced documentation files exist and were updated
- Detects new features/APIs that might need documentation

### Coverage Decrease Prevention

**Script**: `scripts/ci/check-coverage-decrease.ts`  
**Command**: `pnpm check:coverage-decrease`

Prevents coverage from decreasing below baseline:

- Compares current coverage against baseline stored in `coverage/.baseline.json`
- Fails if any threshold (lines, functions, branches, statements) decreases
- Updates baseline with `--update-baseline` flag

## Smoke Tests

**Command**: `pnpm test:smoke`

Quick validation that critical paths work (< 30 seconds):

- **Build Smoke Test** - All packages build successfully
- **Import Smoke Test** - All public APIs can be imported
- **Handler Smoke Test** - All CLI handlers are callable
- **Quality Gates Smoke Test** - Quality gate infrastructure is functional

## GitHub Workflows

### PR Quality Gates

**Workflow**: `.github/workflows/pr-quality-gates.yml`

Runs on every pull request and enforces:

1. **lint-and-build** - ESLint, build, type check, architecture boundaries
2. **test-requirements** - Handler tests, property tests, test requirements
3. **documentation** - CHANGELOG, documentation updates
4. **tests** - Unit, integration, property, fuzzing tests with coverage
5. **coverage-check** - Coverage decrease prevention
6. **smoke-tests** - Critical path validation

### Release Quality Gates

**Workflow**: `.github/workflows/release-quality-gates.yml`

Runs before release and enforces:

1. **pre-release-checks** - All PR quality gate checks
2. **stress-tests** - Database stress tests, chaos engineering tests
3. **coverage-verification** - Coverage meets thresholds, no decrease
4. **documentation-review** - All documentation up to date, migration guides exist
5. **changelog-verification** - CHANGELOG has version section, format compliance

## Running Quality Gates Locally

### Quick Check (Pre-Commit)

The pre-commit hook runs lightweight checks:

```bash
# Automatically runs on git commit:
# - Format check
# - Lint fix
# - Type check
# - Workflow contracts
# - Dependency boundaries
# - CHANGELOG check (warning only)
# - Handler tests check (warning only)
```

### Full Quality Gate Suite

Run all quality gate checks:

```bash
# PR quality gates
pnpm quality-gates:pr

# Release quality gates (includes stress tests)
pnpm quality-gates:release
```

### Individual Checks

Run specific checks:

```bash
# Handler tests
pnpm verify:handler-tests

# Property tests
pnpm verify:property-tests

# CHANGELOG
pnpm verify:changelog

# Documentation
pnpm verify:documentation

# Coverage decrease
pnpm check:coverage-decrease

# Smoke tests
pnpm test:smoke
```

## Troubleshooting

### Handler Test Verification Fails

**Error**: `Handler test verification found issues`

**Solutions**:
1. Create test file at `packages/cli/tests/unit/handlers/{package}/{handler-name}.test.ts`
2. Import and test the handler function
3. Verify handler doesn't use forbidden patterns (console.log, process.exit, etc.)
4. Ensure tests verify: parameter conversion, error propagation, service calls

### Property Test Verification Fails

**Error**: `Found financial calculation(s) without property tests`

**Solutions**:
1. Create property test file in `packages/{package}/tests/properties/{function-name}.test.ts`
2. Test financial invariants (monotonicity, bounds, conservation laws)
3. Use fast-check for property-based testing
4. Follow existing property test patterns (see `packages/simulation/tests/properties/`)

### CHANGELOG Verification Fails

**Error**: `CHANGELOG.md missing [Unreleased] section` or `CHANGELOG.md [Unreleased] section has no entries`

**Solutions**:
1. Add `[Unreleased]` section at the top of CHANGELOG.md
2. Add entries for your changes in appropriate sections:
   - `### Security` - Security fixes (with severity: **CRITICAL**, **HIGH**, **MEDIUM**)
   - `### Fixed` - Bug fixes (with severity if critical)
   - `### Added` - New features
   - `### Changed` - Changes to existing functionality
   - `### Deprecated` - Soon-to-be removed features
   - `### Removed` - Removed features
3. Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format

### Coverage Decrease Check Fails

**Error**: `Coverage decreased below baseline`

**Solutions**:
1. Add tests to increase coverage
2. Or update baseline if decrease is acceptable:
   ```bash
   pnpm check:coverage-decrease --update-baseline
   ```
3. Ensure coverage meets minimum thresholds (60% for lines, functions, branches, statements)

### Documentation Verification Fails

**Error**: `Missing documentation files` or `Documentation files referenced but not updated`

**Solutions**:
1. Create referenced documentation files
2. Or remove/update `DOCS:` comments if documentation is not needed
3. Update documentation files in the same PR as code changes
4. Add documentation for new features/APIs

## Baseline Management

### Coverage Baseline

The coverage baseline is stored in `coverage/.baseline.json` and is updated:

- Automatically on successful PR merge (if configured)
- Manually with `pnpm check:coverage-decrease --update-baseline`

**Best Practice**: Update baseline after each release to reflect new coverage targets.

## Enforcement

### Pre-Commit

- Fast checks only (format, lint, typecheck, boundaries)
- CHANGELOG and handler tests are warnings (not blocking)
- Full enforcement happens in CI

### CI/CD

- All quality gate checks must pass before PR merge
- Release quality gates must pass before release
- Coverage decrease blocks PR merge
- Missing tests block PR merge

### Branch Protection

Configure branch protection rules to require:

- PR quality gate workflow to pass
- Release quality gate workflow to pass (for release branches)
- Code review approval
- Up-to-date branches

## Success Criteria

- ✅ All PRs pass quality gate checks before merge
- ✅ All releases pass release quality gate checks
- ✅ Coverage never decreases below baseline
- ✅ All handlers have tests
- ✅ All financial calculations have property tests
- ✅ CHANGELOG always updated for functional changes
- ✅ Documentation always updated when code changes
- ✅ Smoke tests run in < 30 seconds
- ✅ Full quality gate suite runs in < 10 minutes

## Related Documentation

- [Testing Rules](.cursor/rules/tests.mdc) - Testing requirements and patterns
- [CLI Handler Contract](.cursor/rules/packages-cli-handlers.mdc) - Handler architecture
- [Changelog Enforcement](.cursor/rules/changelog-enforcement.mdc) - CHANGELOG requirements
- [Architecture Boundaries](docs/architecture/) - Package boundaries and dependencies

