# Build Status & Next Steps

## Current Status

### ✅ Successfully Built
- **@quantbot/utils** - Builds cleanly (with 2 files excluded)

### ❌ Build Errors  
- **@quantbot/storage** - Cannot find @quantbot/utils
- **@quantbot/simulation** - Cannot find @quantbot/utils, multiple export conflicts
- **@quantbot/services** - Not tested yet (depends on above)
- **@quantbot/monitoring** - Not tested yet (depends on above)  
- **@quantbot/bot** - Not tested yet (depends on above)

## Root Cause

TypeScript in package mode needs to reference other packages' **compiled output** (`dist/`), not their source. The current setup has:

1. ✅ Path mappings pointing to `src/` (good for development)
2. ❌ No composite project references for builds
3. ❌ Packages trying to import from source before dist exists

## Solutions (Choose One)

### Option 1: Build in Dependency Order (Quick Fix)
Build packages one at a time in dependency order, so dist/ exists for imports:

```bash
# Build foundation first
cd packages/utils && npm run build && cd ../..

# Build packages that depend on utils
cd packages/storage && npm run build && cd ../..
cd packages/simulation && npm run build && cd ../..

# Build packages that depend on storage & simulation  
cd packages/services && npm run build && cd ../..
cd packages/monitoring && npm run build && cd ../..

# Build final packages
cd packages/bot && npm run build && cd ../..
```

**Pros**: Simple, works immediately  
**Cons**: Manual, doesn't handle incremental builds

### Option 2: Use TypeScript Project References (Proper Fix)
Set up proper composite project references in root tsconfig.json:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/utils" },
    { "path": "./packages/storage" },
    { "path": "./packages/simulation" },
    { "path": "./packages/services" },
    { "path": "./packages/monitoring" },
    { "path": "./packages/bot" }
  ]
}
```

Then build with:
```bash
tsc --build --verbose
```

**Pros**: Proper TypeScript monorepo setup, incremental builds  
**Cons**: Requires more tsconfig changes

### Option 3: Use a Build Tool (Best Long-term)
Use `turbo repo`, `nx`, or `lerna` for proper monorepo builds:

```bash
npm install --save-dev turbo
# Configure turbo.json with package dependencies
turbo run build
```

**Pros**: Industry standard, handles dependencies automatically, caching  
**Cons**: Additional tooling to learn

## Immediate Fixes Applied

1. ✅ Added `baseUrl` and empty `paths` to all package tsconfig files
2. ✅ Excluded problematic files from utils build:
   - `fetch-historical-candles.ts` (depends on external APIs)
   - `RepeatSimulationHelper.ts` (depends on bot types)
3. ✅ Fixed export name in utils (CreditMonitor → creditMonitor)
4. ✅ Fixed type annotations in monitored-tokens-db.ts

## Recommended Next Steps

### Immediate (5 minutes)
Use **Option 1** to get packages building:

```bash
#!/bin/bash
# Build packages in dependency order
echo "Building @quantbot/utils..."
npm run build --workspace=packages/utils

echo "Building @quantbot/storage..."
npm run build --workspace=packages/storage

echo "Building @quantbot/simulation..."  
npm run build --workspace=packages/simulation

echo "Building @quantbot/services..."
npm run build --workspace=packages/services

echo "Building @quantbot/monitoring..."
npm run build --workspace=packages/monitoring

echo "Building @quantbot/bot..."
npm run build --workspace=packages/bot

echo "✅ All packages built!"
```

### Short-term (30 minutes)
Implement **Option 2** for proper TypeScript project references

### Long-term (2 hours)
Implement **Option 3** with Turborepo for production-grade monorepo builds

## Known Issues to Fix

### @quantbot/simulation
- Export conflicts in index.ts (duplicate exports from config and engine)
- Old imports still referencing `../storage/clickhouse-client`
- Missing ichimoku type properties

### @quantbot/services
- Needs external API package created
- Cache dependencies need resolving

### General
- 45 scripts still reference old paths
- Some test files may need path updates

## Build Script for package.json

Add this to root package.json:

```json
{
  "scripts": {
    "build:all": "npm run build:utils && npm run build:storage && npm run build:simulation && npm run build:services && npm run build:monitoring && npm run build:bot",
    "build:utils": "npm run build --workspace=packages/utils",
    "build:storage": "npm run build --workspace=packages/storage",
    "build:simulation": "npm run build --workspace=packages/simulation",
    "build:services": "npm run build --workspace=packages/services",
    "build:monitoring": "npm run build --workspace=packages/monitoring",
    "build:bot": "npm run build --workspace=packages/bot"
  }
}
```

Then just run: `npm run build:all`

## Testing After Build

Once all packages build:

```bash
# Test individual packages
npm test --workspace=packages/utils
npm test --workspace=packages/storage
# ... etc

# Run all tests
npm run test:packages
```

## Success Criteria

- [ ] All 7 packages build without errors
- [ ] All package tests pass
- [ ] Bot starts: `npm start`
- [ ] Web builds: `cd packages/web && npm run build`
- [ ] No TypeScript errors in IDE

## Current Blockers

1. ❌ Circular/missing dependencies between packages
2. ❌ Export conflicts in simulation package
3. ❌ Old path references in some files

**Estimated time to resolve**: 1-2 hours using Option 1 + fixes

