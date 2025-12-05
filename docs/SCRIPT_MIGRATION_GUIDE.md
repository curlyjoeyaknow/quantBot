# Script Migration Guide

## Overview

Scripts in the `/scripts/` directory need to be updated to use the new package-based imports instead of referencing the old `/src/` directory.

## Migration Status

### Scripts That Need Updates

All scripts in the following directories reference the old `/src/` structure:
- `scripts/analysis/` - Analysis and reporting scripts
- `scripts/monitoring/` - Monitoring and streaming scripts  
- `scripts/simulation/` - Simulation runner scripts
- `scripts/test/` - Test utilities
- `scripts/data-processing/` - Data ingestion scripts
- `scripts/optimization/` - Strategy optimization scripts

### Common Import Pattern Changes

#### OLD Pattern
```typescript
import { logger } from '../src/utils/logger';
import { Strategy } from '../src/simulation/engine';
import { queryPostgres } from '../src/storage/postgres-client';
import { birdeyeClient } from '../src/api/birdeye-client';
```

#### NEW Pattern
```typescript
import { logger, Strategy } from '@quantbot/utils';
import { simulateStrategy } from '@quantbot/simulation';
import { queryPostgres } from '@quantbot/storage';
// API clients: Need to be moved to packages or injected
```

## Key Scripts to Update

### High Priority (Frequently Used)
1. `scripts/monitoring/start-brook-monitoring.ts` - Live monitoring
2. `scripts/simulation/run-engine.ts` - Simulation runner
3. `scripts/analysis/score-and-analyze-unified-calls.ts` - Analysis tool

### Medium Priority
4. `scripts/analysis/analyze-brook-token-selection.ts`
5. `scripts/analysis/view-scored-results.ts`
6. `scripts/test/*` - Test utilities

### Low Priority (Legacy/Rarely Used)
7. `scripts/legacy/*` - Old scripts, may be deprecated

## Migration Steps for Each Script

1. **Identify all imports from `../src/`**
   ```bash
   grep "from ['\"]\.\.\/src/" script-name.ts
   ```

2. **Map old paths to new packages:**
   - `../src/utils/*` → `@quantbot/utils`
   - `../src/storage/*` → `@quantbot/storage`
   - `../src/simulation/*` → `@quantbot/simulation`
   - `../src/services/*` → `@quantbot/services`
   - `../src/monitoring/*` → `@quantbot/monitoring`
   - `../src/bot/*` → `@quantbot/bot`
   - `../src/api/*` → **TBD - needs external APIs package**
   - `../src/cache/*` → **TBD - integrate into storage or services**
   - `../src/events/*` → **TBD - move to bot or services**

3. **Update the imports**

4. **Test the script**
   ```bash
   ts-node scripts/path/to/script.ts
   ```

## Scripts That May Need Deprecation

Some legacy scripts may no longer be needed after the migration:
- Old simulation scripts superseded by `run-engine.ts`
- Duplicate data processing scripts
- One-off migration scripts

These should be moved to `scripts/archive/` after verification.

## TypeScript Configuration for Scripts

The `tsconfig.scripts.json` should include:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "outDir": "./dist/scripts",
    "module": "commonjs",
    "esModuleInterop": true
  },
  "include": ["scripts/**/*"],
  "exclude": ["scripts/legacy/**/*"]
}
```

## Running Scripts After Migration

```bash
# Using ts-node directly
npx ts-node -r dotenv/config scripts/analysis/some-script.ts

# Using npm scripts (if defined in package.json)
npm run analyze:tokens

# For scripts requiring build
npm run build:packages
node dist/scripts/some-script.js
```

## Known Issues

### External API Clients
Scripts using `birdeyeClient`, `heliusClient`, etc. will need updates once API clients are moved to a package.

**Temporary solution**: Leave these imports commented with TODO until API clients package is created.

### Event Bus
Scripts using event bus need to import from the appropriate package once events are relocated.

### Cache
Scripts directly using cache implementations need refactoring to use services instead.

## Automated Migration Script

A batch migration script can be created:

```bash
#!/bin/bash
# migrate-script-imports.sh

for file in scripts/**/*.ts; do
  # Skip legacy scripts
  if [[ $file == *"legacy"* ]]; then
    continue
  fi
  
  echo "Migrating $file..."
  
  # Utils
  sed -i "s|from '\.\./src/utils/|from '@quantbot/utils/|g" "$file"
  sed -i "s|from \"\.\./src/utils/|from '@quantbot/utils/|g" "$file"
  
  # Storage
  sed -i "s|from '\.\./src/storage/|from '@quantbot/storage/|g" "$file"
  sed -i "s|from \"\.\./src/storage/|from '@quantbot/storage/|g" "$file"
  
  # Simulation  
  sed -i "s|from '\.\./src/simulation/|from '@quantbot/simulation/|g" "$file"
  sed -i "s|from \"\.\./src/simulation/|from '@quantbot/simulation/|g" "$file"
  
  # Services
  sed -i "s|from '\.\./src/services/|from '@quantbot/services/|g" "$file"
  sed -i "s|from \"\.\./src/services/|from '@quantbot/services/|g" "$file"
  
  # Monitoring
  sed -i "s|from '\.\./src/monitoring/|from '@quantbot/monitoring/|g" "$file"
  sed -i "s|from \"\.\./src/monitoring/|from '@quantbot/monitoring/|g" "$file"
done
```

## Testing Checklist

After migrating scripts:
- [ ] All packages build successfully: `npm run build:packages`
- [ ] Key analysis scripts run: `npm run analyze:tokens`
- [ ] Monitoring scripts start: `npm run monitor:brook`
- [ ] Simulation scripts execute: `npm run simulate:config`
- [ ] No TypeScript errors in scripts
- [ ] All required data is accessible
- [ ] Environment variables are loaded correctly

## Notes

- Scripts that are run frequently should have npm script entries in `package.json`
- Scripts that are run rarely can be executed with `ts-node` directly
- Legacy scripts in `scripts/legacy/` can be migrated later or archived
- Consider moving complex script logic into packages (e.g., analysis tools → @quantbot/services)

