# CLI Wrapper Pattern - Locked In

This document describes the standardized command wrapper pattern that prevents the "normalizeOptions v7" regression and ensures consistent CLI command implementation.

## Status: ✅ Pattern Locked

The following mechanisms ensure the pattern doesn't regress:

### 1. ESLint Enforcement ✅

**Location**: `eslint.config.mjs`

**Rules**:

- Bans importing `execute()` directly from outside `packages/cli/src/core/`
- Bans importing `normalizeOptions` directly from outside `packages/cli/src/core/`
- Enforces `defineCommand()` usage for all new commands

**Why this matters**: Prevents developers from bypassing the wrapper and reinventing normalization logic.

### 2. Golden Tests ✅

**Location**: `packages/cli/tests/unit/core/defineCommand-coercion.test.ts`

**Tests verify**:

- `--lags-ms '[0,10000]'` → `opts.lagsMs: number[]` (camelCase key preserved)
- `--intervals '["1m","5m"]'` → `opts.intervals: string[]` (camelCase key preserved)
- Keys are never mutated (no renaming from camelCase to kebab-case)
- Comma-separated strings also work

**Why this matters**: These tests would have caught the original normalization drift that caused headwind. If they fail, the pattern is broken.

### 3. Standard Pattern Documentation ✅

**Location**: `packages/cli/src/core/README.md`

**Documents**:

- Commander owns flags & parsing (kebab-case → camelCase)
- Wrapper owns: coercion, schema validation, error formatting
- Invariant: Normalization never renames keys

**Why this matters**: Makes it easy for developers to copy/paste the correct pattern instead of inventing their own.

## The Pattern (Copy/Paste This)

```typescript
import { defineCommand } from '../core/defineCommand.js';
import { coerceStringArray, coerceNumberArray } from '../core/coerce.js';
import { die } from '../core/cliErrors.js';
import { sweepCallsSchema } from '../command-defs/calls.js';

const cmd = parent
  .command('sweep')
  .requiredOption('--intervals <json>', 'JSON array of intervals')
  .requiredOption('--lags-ms <json>', 'JSON array of lag values');

defineCommand(cmd, {
  name: 'sweep',
  packageName: 'calls',
  coerce: (raw) => ({
    ...raw,
    intervals: raw.intervals ? coerceStringArray(raw.intervals, 'intervals') : undefined,
    lagsMs: raw.lagsMs ? coerceNumberArray(raw.lagsMs, 'lags-ms') : undefined,
  }),
  validate: (opts) => sweepCallsSchema.parse(opts),
  onError: die,
});
```

## Key Principles

1. **Commander converts kebab-case to camelCase** (`--lags-ms` → `lagsMs`)
2. **Schema uses camelCase** (matches Commander output)
3. **Coerce only parses values** (JSON/numbers/arrays), never renames keys
4. **Handler receives camelCase** (consistent throughout)

## Sweep Path Verified ✅

The sweep command (`calls sweep`) uses the wrapper pattern and creates all required outputs:

- `per_call.jsonl` - One row per call × overlay × lag × interval
- `per_caller.jsonl` - Aggregated by caller per configuration
- `matrix.json` - Aggregated by caller × lag × interval × overlaySet
- `run.meta.json` - Metadata (git sha, config hash, timestamps)

**Run it**:

```bash
bash scripts/dev/run-calls-sweep-tsx.sh calls sweep \
  --calls-file calls.json \
  --intervals '["1m","5m"]' \
  --lags-ms '[0,10000,30000]' \
  --overlays-file overlays.json \
  --out out/sweep-001/
```

**Analyze results**:

```bash
tsx scripts/analyze-sweep-duckdb.ts out/sweep-001/
```

## Known Violations (To Be Migrated)

### `calls export` Command

**Issue**: Uses kebab-case in schema (`exportCallsSchema`) and manually renames keys in action handler.

**Location**:

- Schema: `packages/cli/src/command-defs/calls.ts:81-89`
- Handler: `packages/cli/src/commands/calls.ts:88-126`

**Fix**: Migrate to `defineCommand()` with camelCase schema matching Commander output.

**Priority**: Low (doesn't block sweep work)

## Next Steps (Optional)

1. **Config Runner** - Single YAML/JSON config file for sweep runs (eliminates TS files per run)
2. **HTML Report** - Static HTML from sweep outputs (leaderboard, robustness, coverage)
3. **Migrate `calls export`** - Update to use `defineCommand()` pattern

## Enforcement Checklist

When reviewing PRs:

- [ ] New commands use `defineCommand()` wrapper
- [ ] Schemas use camelCase (matching Commander output)
- [ ] Coercion only parses values, never renames keys
- [ ] ESLint rules pass (no direct `execute()` imports)
- [ ] Golden tests pass (coercion works correctly)

## References

- Pattern documentation: `packages/cli/src/core/README.md`
- Golden tests: `packages/cli/tests/unit/core/defineCommand-coercion.test.ts`
- Example implementation: `packages/cli/src/commands/calls.ts:152-164`
- Coercion helpers: `packages/cli/src/core/coerce.ts`
