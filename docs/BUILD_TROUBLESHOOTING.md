# Build Troubleshooting Guide

## Common Build Issues

### 1. TypeScript thinks build is up-to-date but dist/ is missing

**Symptom**: `tsc --build` completes successfully but `dist/` directory doesn't exist or is empty.

**Cause**: Stale `*.tsbuildinfo` files. TypeScript's incremental compilation uses these cache files to decide if a rebuild is needed. If `dist/` is deleted but `.tsbuildinfo` remains, TypeScript thinks everything is already built.

**Fix**: Always clean both `dist/` and `*.tsbuildinfo` files:

```bash
./scripts/clean-build.sh
pnpm build:ordered
```

The `clean-build.sh` script removes:

- All `dist/` directories
- All `*.tsbuildinfo` files

### 2. "Cannot find module @quantbot/xyz" errors

**Symptom**: Build fails with module resolution errors for workspace packages.

**Causes**:

1. **Build order race condition**: Packages build in parallel but depend on each other's `dist/` folders.
2. **Missing project references**: Package `tsconfig.json` doesn't reference dependencies.
3. **Package didn't actually emit**: Build script completed but didn't create `dist/` files.

**Fixes**:

1. **Use `build:ordered` for release builds** (already configured):

   ```bash
   pnpm build:ordered
   ```

2. **Or force sequential builds**:

   ```bash
   pnpm -r --workspace-concurrency=1 build
   ```

3. **Verify project references** in `tsconfig.json`:

   ```json
   {
     "references": [
       { "path": "../core" },
       { "path": "../utils" }
     ]
   }
   ```

4. **Verify package.json dependencies**:

   ```json
   {
     "dependencies": {
       "@quantbot/core": "workspace:*"
     }
   }
   ```

### 3. Package builds but doesn't emit files

**Symptom**: Build completes but `dist/` is empty or missing.

**Causes**:

1. **Build script uses `--noEmit`**: Type checking only, no output.
2. **Wrong `outDir`**: Output goes to different location.
3. **Missing `composite: true`**: Required for project references.
4. **Missing `declaration: true`**: No `.d.ts` files generated.

**Checklist**:

1. **Verify build script** (`package.json`):

   ```json
   {
     "scripts": {
       "build": "tsc --build"  // ✅ Correct
       // NOT: "tsc --noEmit"  // ❌ Wrong
     }
   }
   ```

2. **Verify tsconfig.json**:

   ```json
   {
     "compilerOptions": {
       "composite": true,          // ✅ Required for project refs
       "declaration": true,        // ✅ Generate .d.ts files
       "declarationMap": true,     // ✅ Source maps for declarations
       "outDir": "./dist"          // ✅ Output directory
       // NOT: "noEmit": true      // ❌ Wrong
     }
   }
   ```

3. **Verify package.json entry points**:

   ```json
   {
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "exports": {
       ".": {
         "types": "./dist/index.d.ts",
         "import": "./dist/index.js"
       }
     }
   }
   ```

4. **Test build output**:

   ```bash
   pnpm --filter @quantbot/core build --reporter=append-only
   ls -la packages/core/dist || echo "❌ dist/ missing"
   ```

### 4. Build succeeds but modules still can't be found

**Symptom**: Build completes, `dist/` exists, but runtime or type checking fails with module resolution errors.

**Causes**:

1. **Workspace links not updated**: Run `pnpm install` after adding dependencies.
2. **Incorrect exports in package.json**: `exports` field doesn't match actual file structure.
3. **TypeScript cache**: Clear `node_modules/.cache` or restart TypeScript server.

**Fixes**:

1. **Reinstall dependencies**:

   ```bash
   pnpm install
   ```

2. **Verify workspace links**:

   ```bash
   ls -la packages/storage/node_modules/@quantbot/
   # Should show symlinks to core, utils, etc.
   ```

3. **Clear caches and rebuild**:

   ```bash
   ./scripts/clean-build.sh
   rm -rf node_modules/.cache
   pnpm install
   pnpm build:ordered
   ```

### 5. Intermittent build failures

**Symptom**: Build works sometimes, fails other times, especially in CI.

**Causes**:

1. **Race conditions**: Parallel builds accessing same files.
2. **Stale caches**: Old build artifacts interfering.
3. **File system timing**: Fast file system operations completing out of order.

**Fixes**:

1. **Always use `build:ordered`** (sequential, correct dependency order):

   ```bash
   pnpm build:ordered
   ```

2. **Clean before build in CI**:

   ```yaml
   - name: Clean build artifacts
     run: ./scripts/clean-build.sh
   
   - name: Build packages (ordered)
     run: pnpm build:ordered
   ```

3. **Add build verification**:

   ```bash
   # After build, verify critical packages have dist/
   test -f packages/core/dist/index.d.ts || exit 1
   test -f packages/utils/dist/index.d.ts || exit 1
   ```

## Recommended Build Workflow

### For Development

```bash
# Clean everything
./scripts/clean-build.sh

# Build in correct order
pnpm build:ordered
```

### For CI/Release

```bash
# Always clean first
./scripts/clean-build.sh

# Use ordered build (sequential, correct dependency order)
pnpm build:ordered

# Verify critical outputs exist
test -f packages/core/dist/index.d.ts || exit 1
test -f packages/utils/dist/index.d.ts || exit 1
test -f packages/storage/dist/index.d.ts || exit 1
```

### For Quick Incremental Builds

```bash
# Only use if you know dependencies are already built
pnpm --filter @quantbot/<package> build
```

## Verification Checklist

Before merging, verify:

- [ ] All packages have `composite: true` in `tsconfig.json`
- [ ] All packages have `declaration: true` in `tsconfig.json`
- [ ] All packages have `outDir` pointing to `dist/`
- [ ] All build scripts use `tsc --build` (not `tsc --noEmit`)
- [ ] All `package.json` files have correct `main` and `types` fields
- [ ] All `package.json` files have correct `exports` matching `dist/` structure
- [ ] All `tsconfig.json` files have correct `references` to dependencies
- [ ] All `package.json` files list workspace dependencies
- [ ] `clean-build.sh` removes both `dist/` and `*.tsbuildinfo`
- [ ] CI uses `build:ordered` (sequential build)

## Quick Diagnostic Commands

```bash
# Check if dist/ exists after build
find packages -name "dist" -type d -exec sh -c 'echo "{}: $(ls {} 2>/dev/null | wc -l) files"' \;

# Check for stale tsbuildinfo files
find packages -name "*.tsbuildinfo" -type f

# Check build scripts
grep -r '"build"' packages/*/package.json

# Check tsconfig composite settings
grep -r "composite" packages/*/tsconfig.json

# Verify workspace links
ls -la packages/storage/node_modules/@quantbot/
```

## Summary

**The "nuke from orbit" fix**:

```bash
./scripts/clean-build.sh
pnpm build:ordered
```

This ensures:

1. All stale caches are removed
2. Builds happen in correct dependency order
3. No race conditions from parallel builds
