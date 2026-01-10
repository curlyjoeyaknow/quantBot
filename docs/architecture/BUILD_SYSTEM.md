# Build System Documentation

## Overview

The QuantBot monorepo uses TypeScript project references for incremental builds and dependency management. This enables faster builds, better IDE support, and compile-time dependency checking.

## Architecture

### TypeScript Project References

All packages use TypeScript's `composite: true` mode with explicit project references. This allows TypeScript to:

- Build packages in the correct dependency order
- Cache build results for faster incremental builds
- Detect circular dependencies at compile time
- Provide better IDE support with proper type resolution

### Build Order

Packages must be built in dependency order. The `build:ordered` script enforces this:

1. **@quantbot/core** - Foundation types (no dependencies)
2. **@quantbot/utils** - Shared utilities (depends on core)
3. **@quantbot/storage** - Storage layer (depends on core, utils)
4. **@quantbot/observability** - Observability (depends on utils, storage)
5. **@quantbot/api-clients** - API clients (depends on core, utils, observability)
6. **@quantbot/ohlcv** - OHLCV data (depends on core, utils, storage, api-clients)
7. **@quantbot/analytics** - Analytics (depends on core, utils, storage)
8. **@quantbot/ingestion** - Data ingestion (depends on core, utils, storage, ohlcv, analytics, api-clients)
9. **Remaining packages** - simulation, workflows, cli, tui (depend on multiple packages)

## Build Commands

### Ordered Build (Recommended)

```bash
pnpm build:ordered
```

Builds packages in the correct dependency order. This is the default `build` command.

### Incremental Build

```bash
pnpm build:incremental
```

Uses TypeScript's incremental compilation for faster builds. Only rebuilds changed packages and their dependents.

### Individual Package Build

```bash
pnpm --filter @quantbot/core build
pnpm --filter @quantbot/utils build
# ... etc
```

Builds a single package. Dependencies must be built first.

### Force Rebuild

```bash
pnpm build:force
```

Forces a full rebuild of all packages, clearing incremental build caches.

## Project References

### Adding a New Package

When adding a new package:

1. **Create `tsconfig.json`** with `composite: true`:
   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "outDir": "./dist",
       "rootDir": "./src",
       "declaration": true,
       "declarationMap": true,
       "composite": true
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist", "**/*.test.ts"],
     "references": [
       { "path": "../core" },
       { "path": "../utils" }
       // ... add all workspace dependencies
     ]
   }
   ```

2. **Add to `package.json`** dependencies:
   ```json
   {
     "dependencies": {
       "@quantbot/core": "workspace:*",
       "@quantbot/utils": "workspace:*"
     }
   }
   ```

3. **Update `build:ordered` script** in root `package.json` if the package is in the first 8 packages

4. **Update `scripts/verify-build-order.ts`** to include the new package

### Reference Rules

- **Always reference direct dependencies** - Don't rely on transitive references
- **Reference order matters** - List dependencies in dependency order
- **Use relative paths** - `{ "path": "../core" }` not absolute paths
- **Include all workspace deps** - Even if only used in tests

## Build Caching

### TypeScript Incremental Builds

TypeScript generates `.tsbuildinfo` files for incremental builds. These are:

- **Cached in CI** - `.github/workflows/build.yml` caches `packages/*/tsconfig.tsbuildinfo`
- **Git ignored** - Added to `.gitignore` (can be committed for team consistency)
- **Package-specific** - Each package has its own cache file

### CI/CD Caching

The GitHub Actions workflow caches:

- `node_modules` - Dependencies cache
- `packages/*/dist` - Build artifacts
- `packages/*/tsconfig.tsbuildinfo` - TypeScript incremental build info

Cache keys are based on file hashes for proper invalidation.

## Build Verification

### Verify Build Order

```bash
pnpm tsx scripts/verify-build-order.ts
```

Validates:
- Dependencies are built before dependents
- No circular dependencies
- All dependencies are found

This script runs automatically in CI before building.

### Type Checking

```bash
pnpm typecheck
```

Runs TypeScript type checking without emitting files. Useful for CI and pre-commit hooks.

## Troubleshooting

### Build Fails with "Output file has not been built"

**Problem**: Package A depends on Package B, but B's declaration files aren't generated.

**Solution**:
1. Build dependencies first: `pnpm --filter @quantbot/utils build`
2. Then build dependent: `pnpm --filter @quantbot/storage build`
3. Or use `pnpm build:ordered` which handles this automatically

### Circular Dependency Detected

**Problem**: TypeScript reports a circular dependency between packages.

**Solution**:
1. Run `pnpm tsx scripts/verify-build-order.ts` to identify the cycle
2. Extract shared code to a common package (usually `@quantbot/utils` or `@quantbot/core`)
3. Update project references to remove the cycle

### Build Cache Issues

**Problem**: Changes aren't reflected after building.

**Solution**:
1. Force rebuild: `pnpm build:force`
2. Clear cache: `rm -rf packages/*/tsconfig.tsbuildinfo`
3. Clean and rebuild: `pnpm clean && pnpm build:ordered`

### Type Errors After Adding References

**Problem**: Adding project references causes new type errors.

**Solution**:
1. Ensure referenced packages are built: `pnpm build:ordered`
2. Check that references match actual imports
3. Verify `composite: true` is set in referenced packages

## Best Practices

1. **Always use `build:ordered`** for full builds
2. **Use `build:incremental`** for development (faster)
3. **Run `verify-build-order.ts`** before committing build changes
4. **Keep references minimal** - Only reference direct dependencies
5. **Update references** when adding/removing dependencies
6. **Test build order** after major dependency changes

## Related Documentation

- [Build Ordering Rules](.cursor/rules/build-ordering.mdc) - Detailed dependency rules
- [Build Status](BUILD_STATUS.md) - Current build status and issues
- [CHANGELOG](../CHANGELOG.md) - Build system changes

