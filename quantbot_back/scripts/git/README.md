# Git Hooks and Test Requirements

## Overview

This directory contains scripts that enforce testing requirements based on the type of code changes and development stage.

## Test Requirements Checker

`check-test-requirements.ts` analyzes staged git changes and ensures appropriate tests are present before allowing commits.

### How It Works

1. **Analyzes staged changes** - Looks at git diff for staged files
2. **Detects change type** - Identifies what kind of code was changed:
   - Financial calculations
   - Parsers
   - Database operations
   - API endpoints
   - Mint address handling
   - Async operations
   - Retry logic
   - Bug fixes
3. **Checks for required tests** - Verifies that appropriate test files exist
4. **Blocks commit if requirements not met** - Provides clear error messages

### Change Type Detection

The script uses pattern matching to detect change types:

- **Financial calculations**: Functions with `calculatePnL`, `calculateFee`, `slippage`, etc.
- **Parsers**: Functions with `parse`, `extract`, `decode`, etc.
- **Database**: Functions with `insert`, `update`, `query`, `repository`, etc.
- **API endpoints**: Routes, controllers, handlers
- **Mint handling**: Any code touching mint addresses
- **Async operations**: `async`, `await`, `Promise`, concurrent operations
- **Retry logic**: Functions with `retry`, `backoff`, etc.
- **Bug fixes**: Commit messages or code comments with `fix`, `bug`, `issue`

### Test Requirements by Type

| Change Type | Required Tests |
|------------|----------------|
| financial-calculation | unit + property |
| parser | unit + fuzzing |
| database | integration |
| api-endpoint | integration + unit |
| mint-handling | unit + property |
| async-operation | unit + concurrency |
| retry-logic | unit + integration |
| bugfix | regression + unit |
| other | unit |

### Development Stage Detection

The script detects development stage from file location:

- **Early**: New files, basic structure
- **Mid**: Unit tests present
- **Late**: Integration/property/fuzzing tests present
- **Production**: E2E/load tests present

## Usage

### Manual Check

```bash
npm run check:test-requirements
```

### Or directly:
```bash
npx ts-node scripts/git/check-test-requirements.ts
```

### Automatic (via Git Hooks)

The script runs automatically on `git commit` via `.husky/pre-commit`.

## Example Output

### ✅ Success
```
🔍 Analyzing changes for test requirements...

✅ All test requirements met!

   ✓ packages/simulation/src/calculatePnL.ts (financial-calculation) - has unit, property tests
```

### ❌ Failure
```
🔍 Analyzing changes for test requirements...

❌ packages/simulation/src/calculatePnL.ts
   Type: financial-calculation
   Stage: mid
   Missing tests: property
   ⚠️  No test file found. Expected: packages/simulation/tests/unit/calculatePnL.test.ts

❌ Test requirements not met. Please add the required tests before committing.
```

## Customization

To add new change types or modify requirements, edit `scripts/git/check-test-requirements.ts`:

1. Add pattern to `PATTERNS` object
2. Add test requirements to `TEST_REQUIREMENTS` object
3. Update `hasTestType` function if adding new test types

## Bypassing (Not Recommended)

To bypass the check (use with caution):

```bash
git commit --no-verify
```

**Warning**: Only bypass for emergency hotfixes. Always add tests afterward.

