# Quality Gates Configuration

## Overview

This document describes the quality gates and CI/CD checks configured for the CLI package.

## Quality Checks

### 1. Code Formatting
**Tool**: Prettier  
**Command**: `npm run format:check`  
**Threshold**: 100% (all files must be formatted)

```bash
# Check formatting
npm run format:check

# Auto-fix formatting
npm run format
```

### 2. Linting
**Tool**: ESLint  
**Command**: `npm run lint`  
**Threshold**: 0 errors, 0 warnings

```bash
# Check linting
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

### 3. Type Checking
**Tool**: TypeScript Compiler  
**Command**: `npm run typecheck`  
**Threshold**: 0 type errors

```bash
npm run typecheck
```

### 4. Unit & Integration Tests
**Tool**: Vitest  
**Command**: `npm test -- --run`  
**Threshold**: 100% passing

```bash
# Run all tests
npm test -- --run

# Run specific test file
npm test -- --run tests/unit/argument-parser.test.ts

# Run tests in watch mode
npm test
```

### 5. Code Coverage
**Tool**: Vitest + v8  
**Command**: `npm run test:coverage`  
**Thresholds**:
- Core components: **90%+** (address-validator, argument-parser, error-handler)
- Supporting components: **80%+** (output-formatter, initialization-manager)
- Command handlers: **80%+** (all command modules)

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html
```

#### Coverage Requirements by Component

| Component | Statements | Branches | Functions | Lines |
|-----------|-----------|----------|-----------|-------|
| address-validator.ts | 90%+ | 85%+ | 90%+ | 90%+ |
| argument-parser.ts | 90%+ | 85%+ | 90%+ | 90%+ |
| error-handler.ts | 90%+ | 85%+ | 90%+ | 90%+ |
| command-registry.ts | 90%+ | 85%+ | 90%+ | 90%+ |
| initialization-manager.ts | 85%+ | 80%+ | 85%+ | 85%+ |
| output-formatter.ts | 80%+ | 75%+ | 80%+ | 80%+ |
| Command modules | 80%+ | 75%+ | 80%+ | 80%+ |

### 6. Mutation Testing
**Tool**: Stryker Mutator  
**Command**: `npm run test:mutation`  
**Thresholds**:
- High: **90%+** (excellent)
- Low: **80%+** (acceptable)
- Break: **<75%** (fails build)

```bash
# Run mutation tests (full)
npm run test:mutation

# Run mutation tests (incremental)
npm run test:mutation:incremental

# View mutation report
open reports/mutation/mutation-report.html
```

#### Mutation Testing Scope
Focused on security-critical components:
- `src/core/address-validator.ts`
- `src/core/argument-parser.ts`
- `src/core/error-handler.ts`
- `src/core/command-registry.ts`

#### Mutation Types Enabled
- ✅ Arithmetic operators (`+` → `-`, `*` → `/`)
- ✅ Boolean literals (`true` → `false`)
- ✅ Conditional expressions (`>` → `<`, `>=` → `<=`)
- ✅ Equality operators (`===` → `!==`)
- ✅ Logical operators (`&&` → `||`)
- ✅ String literals (mutation of string values)
- ✅ Block statements (removal of code blocks)
- ❌ Array declarations (disabled, too noisy)
- ❌ Object literals (disabled, too noisy)

### 7. Security Audit
**Tool**: npm audit  
**Command**: `npm audit --audit-level=moderate`  
**Threshold**: 0 moderate or higher vulnerabilities

```bash
# Check for vulnerabilities
npm audit

# Auto-fix vulnerabilities
npm audit fix

# Force fix (may introduce breaking changes)
npm audit fix --force
```

### 8. Build Verification
**Tool**: TypeScript Compiler  
**Command**: `npm run build`  
**Threshold**: Successful build with no errors

```bash
# Build the package
npm run build

# Check build artifacts
ls -la dist/
```

## CI/CD Pipeline

### GitHub Actions Workflow
**File**: `.github/workflows/quality-gates.yml`

#### Jobs

##### 1. Quality Checks (Always Run)
- ✅ Format check
- ✅ Lint check
- ✅ Type check
- ✅ Unit & integration tests
- ✅ Coverage check
- ✅ Security audit
- ✅ Coverage upload to Codecov

**Triggers**:
- Push to `main` or `develop`
- Pull requests to `main` or `develop`

##### 2. Mutation Testing (PR Only)
- 🧬 Run mutation tests
- 📊 Upload mutation report
- 💬 Comment PR with mutation score

**Triggers**:
- Pull requests only (expensive operation)

##### 3. Dependency Check (Always Run)
- 📦 Check for outdated dependencies
- ⚠️ Check for deprecated dependencies

##### 4. Build Check (Always Run)
- 🏗️ Build the package
- ✅ Verify build artifacts

### Branch Protection Rules

#### Main Branch
- ✅ Require status checks to pass
- ✅ Require branches to be up to date
- ✅ Require linear history
- ✅ Require signed commits
- ✅ Require code review (1+ approvals)

**Required Status Checks**:
- `quality-checks`
- `build-check`
- `dependency-check`

#### Develop Branch
- ✅ Require status checks to pass
- ✅ Require branches to be up to date

**Required Status Checks**:
- `quality-checks`
- `build-check`

## Local Quality Checks

### Quick Check (Pre-Commit)
```bash
npm run quality:check
```

Runs:
1. Format check
2. Lint
3. Type check
4. Tests

**Duration**: ~5-10 seconds

### Full Check (Pre-Push)
```bash
npm run quality:full
```

Runs:
1. All quick checks
2. Coverage report
3. Mutation tests

**Duration**: ~2-5 minutes

## Git Hooks

### Pre-Commit Hook
**File**: `.husky/pre-commit`

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

cd packages/cli
npm run format:check
npm run lint:fix
npm run typecheck
npm test -- --run --related
```

### Pre-Push Hook
**File**: `.husky/pre-push`

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

cd packages/cli
npm test -- --run
npm run test:coverage
npm audit
npm run build
```

## Quality Metrics

### Current Status (2025-12-15)

| Metric | Target | Current | Status |
|--------|--------|---------|--------|
| Test Pass Rate | 100% | 100% (320/320) | ✅ |
| Core Coverage | 90%+ | 91.80% | ✅ |
| Address Validator | 90%+ | 94.59% | ✅ |
| Argument Parser | 90%+ | 96.66% | ✅ |
| Command Registry | 90%+ | 97.72% | ✅ |
| Error Handler | 90%+ | 100.00% | ✅ |
| Init Manager | 85%+ | 95.34% | ✅ |
| Output Formatter | 80%+ | 76.66% | ⚠️ |
| Mutation Score | 80%+ | TBD | 🔄 |
| Security Audit | 0 issues | 0 issues | ✅ |
| Type Errors | 0 | 0 | ✅ |
| Lint Errors | 0 | 0 | ✅ |

### Action Items
- ⚠️ **Output Formatter**: Increase coverage from 76.66% to 80%+
- 🔄 **Mutation Testing**: Run first mutation test to establish baseline

## Continuous Improvement

### Weekly
- Review test coverage trends
- Update outdated dependencies
- Review security advisories

### Monthly
- Run full mutation test suite
- Review and update quality thresholds
- Analyze test performance

### Quarterly
- Audit test suite effectiveness
- Review and update testing strategy
- Benchmark against industry standards

## Troubleshooting

### Coverage Below Threshold
```bash
# Generate detailed coverage report
npm run test:coverage

# Open HTML report to identify gaps
open coverage/index.html

# Add tests for uncovered code
```

### Mutation Score Below Threshold
```bash
# Run incremental mutation tests
npm run test:mutation:incremental

# View mutation report
open reports/mutation/mutation-report.html

# Identify survived mutants and add tests
```

### Build Failures
```bash
# Clean build artifacts
rm -rf dist/

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Rebuild
npm run build
```

### Test Failures
```bash
# Run tests in watch mode
npm test

# Run specific test file
npm test -- --run tests/unit/argument-parser.test.ts

# Run tests with verbose output
npm test -- --run --reporter=verbose
```

## References

- [Vitest Documentation](https://vitest.dev/)
- [Stryker Mutator Documentation](https://stryker-mutator.io/)
- [ESLint Documentation](https://eslint.org/)
- [Prettier Documentation](https://prettier.io/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

---

**Last Updated**: 2025-12-15  
**Maintained By**: QuantBot Team  
**Status**: ✅ Active

