# Linting Strategy: Strict Where It Matters

**Philosophy**: "Truth code is strict. Glue code is honest."

## Core Principle

Strict rules are like risk controls: you want them hardest on the hot path and the truth boundaries, and slightly softer in adapter glue where the world is messy.

## The Two Kinds of Strictness

### ✅ The Good Kind (Keep It)

**Boundaries**: Derived can't fetch, simulation can't touch I/O, etc.

- Architecture boundaries enforced via `no-restricted-imports`
- Simulation package cannot import storage/I/O (enforced)
- Analytics cannot fetch from APIs (enforced)
- Workflows coordinate, handlers are thin adapters

**Determinism**: No `Date.now()`/`Math.random()` in sim paths

- Critical for reproducibility
- Enforced in simulation package

**Workflow Contracts**: Clear, versionable interfaces

- JSON-serializable results
- Explicit error policies
- Structured specs

**No Live Trading in QuantBot**: Your best boundary of all

- Prevented via `no-restricted-imports` blocking `@solana/web3.js` transaction builders

### ⚠️ The Bad Kind (Trim It)

**Unused vars/imports in scaffolding**: Sometimes you're intentionally building up

- Allow with `_` prefix: `const _unusedVar = ...`
- Common in test setup, adapter scaffolding

**`no-case-declarations` everywhere**: Useful rule, but noisy

- Fix surgically where it matters (hot paths)
- Allow in adapter code where it's harmless

**`no-explicit-any` in adapters**: Sometimes "any" is the least-worst truth

- Third-party APIs are messy
- Allow `any` in `adapters/**` directories with comment explaining why
- Prefer `unknown` + narrowing when possible

## Phase-Based Strictness

Split "strictness" by phase — you already think in phases, use it.

### Sacred Zone (Simulation / Workflows / Core)

**Keep current strictness or increase it**

- Warnings should hurt here
- Use `.eslintrc-strict.json` or equivalent
- Errors for:
  - `@typescript-eslint/no-explicit-any`
  - `@typescript-eslint/no-unused-vars` (except `_` prefix)
  - `no-console` (use logger)
  - Architecture violations

**Packages:**
- `packages/simulation/`
- `packages/workflows/`
- `packages/core/`
- `packages/analytics/`

### Messy Zone (Adapters / Lab / Scripts)

**Allow controlled escape hatches:**

- Unused vars allowed if prefixed `_`
- `any` allowed only in `adapters/**` (or require `unknown` + narrowing)
- `console` allowed only in `scripts/**` or `dev/**`
- Relaxed `no-case-declarations`

**Packages:**
- `packages/*/src/adapters/**`
- `packages/lab/`
- `packages/cli/src/bin/**` (user-facing output)
- `packages/*/scripts/**`
- `packages/*/dev/**`

## Warning Management: Policy A (Recommended)

**"Warnings don't grow"**

1. **Record current warning count**: ~180-185 warnings (as of 2024-12-28)
2. **Add CI check**: Fail if warnings increase above baseline
3. **Gradually burn them down**: Fix warnings as you touch code

### Implementation

Add to CI workflow:

```yaml
- name: Check lint warnings don't grow
  run: |
    WARNING_COUNT=$(pnpm lint 2>&1 | grep -c "warning" || echo "0")
    MAX_WARNINGS=185  # Current baseline
    if [ "$WARNING_COUNT" -gt "$MAX_WARNINGS" ]; then
      echo "Error: Lint warnings increased from $MAX_WARNINGS to $WARNING_COUNT"
      exit 1
    fi
```

### Alternative: Policy B (Not Recommended)

**"Warnings become errors only in sacred zones"**

- Turn on fail-on-warn only for `sim/core/workflows`
- Leave `lab/adapters` as warn-only
- More complex, more drama

**Why Policy A is better**: Simpler, prevents warning bloat, encourages gradual cleanup.

## Current ESLint Setup

### Base Config (`eslint.config.mjs`)

- Warnings for:
  - `@typescript-eslint/no-explicit-any`
  - `@typescript-eslint/no-unused-vars` (allows `_` prefix)
  - `no-case-declarations`
- Errors for:
  - Architecture boundaries (`no-restricted-imports`)
  - `eqeqeq`, `no-var`

### Strict Config (`.eslintrc-strict.json`)

Used by `packages/simulation/`:
- Errors for `no-explicit-any`, `no-unused-vars`, `no-console`
- Architecture boundaries enforced

### Test Files

- All rules relaxed (appropriate for test code)
- `no-explicit-any`: off
- `no-unused-vars`: off
- `no-console`: off

## Migration Path

1. **Immediate**: Implement Policy A (CI check for warning count)
2. **Short-term**: Apply strict config to workflows/core packages
3. **Medium-term**: Gradually fix warnings in sacred zones
4. **Long-term**: Consider stricter rules in adapters where it makes sense

## Examples

### ✅ Allowed in Adapters

```typescript
// packages/storage/src/adapters/clickhouse-adapter.ts
export async function adaptThirdPartyApi(data: any): Promise<Result> {
  // Third-party API returns untyped data
  // Using 'any' is honest here - we don't know the shape
  // We'll validate and narrow immediately below
  if (!data || typeof data !== 'object') {
    return { error: 'Invalid data' };
  }
  // ... validate and narrow to known type
}
```

### ❌ Not Allowed in Sacred Zone

```typescript
// packages/simulation/src/engine.ts
export function calculatePnL(trade: any): number {  // ERROR: no-explicit-any
  // Must use proper type
}
```

### ✅ Intentional Scaffolding

```typescript
// packages/workflows/src/new-feature.ts
const _futureUse = someValue;  // Will use this in next PR
// Allowed: prefixed with _
```

## Summary

**Keep strict where truth lives (sim, workflows, core). Allow escape hatches in glue (adapters, lab, scripts). Prevent warning bloat with Policy A.**

