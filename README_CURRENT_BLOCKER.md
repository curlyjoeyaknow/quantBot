# 🚧 Current Blocker: Circular Dependency

## Status
- ✅ @quantbot/utils - **BUILDING**
- 🔄 @quantbot/storage - **BLOCKED** (circular dependency with simulation)
- 🔄 @quantbot/simulation - **BLOCKED** (circular dependency with storage)

## The Problem

TypeScript composite projects detected a circular reference:
```
storage → simulation → storage (CIRCULAR!)
```

### Why This Happens

1. **storage/clickhouse-client.ts** imports:
   ```typescript
   import type { Candle } from '@quantbot/simulation';
   ```

2. **simulation** references storage in `tsconfig.json`:
   ```json
   "references": [{ "path": "../storage" }]
   ```

This creates a cycle that TypeScript composite mode cannot resolve.

## The Solution (15 minutes)

### Step 1: Move Candle Type to Utils

Add to `packages/utils/src/types.ts`:
```typescript
/**
 * Candle Data Structure
 * Represents OHLCV (Open, High, Low, Close, Volume) candlestick data
 */
export interface Candle {
  timestamp: number;  // Unix timestamp
  open: number;       // Opening price
  high: number;       // Highest price
  low: number;        // Lowest price
  close: number;      // Closing price
  volume: number;     // Trading volume
}
```

### Step 2: Update Storage Import

In `packages/storage/src/clickhouse-client.ts`:
```typescript
// OLD
import type { Candle } from '@quantbot/simulation';

// NEW
import type { Candle } from '@quantbot/utils';
```

### Step 3: Update Simulation Exports

In `packages/simulation/src/index.ts`, add re-export:
```typescript
// Re-export shared types from utils for convenience
export type { Candle } from '@quantbot/utils';
```

### Step 4: Remove Circular Reference

In `packages/storage/tsconfig.json`:
```json
"references": [
  { "path": "../utils" }
  // Remove: { "path": "../simulation" }
]
```

### Step 5: Rebuild

```bash
cd /home/memez/quantBot
rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo
./build-packages.sh
```

## Why This Works

The dependency graph becomes:
```
utils (base, no dependencies)
  ↓
storage (depends only on utils)
  ↓
simulation (depends on utils + storage)
  ↓
services (depends on utils + storage + simulation)
```

**No cycles!** ✅

## Implementation Commands

```bash
# 1. Add Candle to utils/types.ts
echo '
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}' >> packages/utils/src/types.ts

# 2. Update storage import
sed -i "s|from '@quantbot/simulation'|from '@quantbot/utils'|" packages/storage/src/clickhouse-client.ts

# 3. Add re-export to simulation
echo "export type { Candle } from '@quantbot/utils';" >> packages/simulation/src/index.ts

# 4. Clean and rebuild
rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo
./build-packages.sh
```

## Expected Result

```
✓ @quantbot/utils built successfully
✓ @quantbot/storage built successfully  
✓ @quantbot/simulation built successfully
✓ @quantbot/services built successfully
...
```

## Alternative Solutions

### Alt 1: Keep Candle in Simulation (Not Recommended)
- Storage would need to NOT use TypeScript references
- Would lose type safety benefits
- Not a good long-term solution

### Alt 2: Create @quantbot/types Package
- More overhead
- Only needed if many shared types
- Overkill for just `Candle`

## Recommendation

✅ **Move Candle to utils** - it's a fundamental data structure used across packages, so it belongs in the base utils package.

---

**Last Updated**: Dec 5, 2025  
**Time to Fix**: ~15 minutes  
**Difficulty**: Easy  
**Impact**: Unblocks 4+ packages from building

