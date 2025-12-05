# Next Steps - Web Package Verification & Testing

## ✅ Completed
- Fixed all script paths to use correct relative paths (`../..` from `packages/web`)
- Fixed all database paths to resolve correctly
- Fixed all export directory paths
- Verified TypeScript compilation (no errors in main code)
- All paths verified to exist and resolve correctly

## 🔍 Immediate Next Steps

### 1. Test Development Server
```bash
cd packages/web
npm run dev
```
- Verify the app starts without errors
- Check that all API routes are accessible
- Test that components load correctly

### 2. Verify Workspace Dependencies
```bash
cd /home/memez/quantBot
npm install  # Ensure all workspace packages are linked
npm list --workspace=packages/web @quantbot/utils @quantbot/storage @quantbot/services @quantbot/simulation
```
- Ensure all `@quantbot/*` packages are properly linked
- Check for any missing dependencies

### 3. Test API Routes
Test the following API endpoints to ensure they work:
- `/api/dashboard` - Dashboard metrics
- `/api/caller-history` - Caller history
- `/api/recent-alerts` - Recent alerts
- `/api/simulations` - Simulations list
- `/api/optimizations` - Optimizations
- `/api/control-panel/services` - Service status
- `/api/control-panel/config` - Configuration

### 4. Test Script Execution
Verify that scripts can be executed from the web package:
```bash
# Test script path resolution
cd packages/web
node -e "const path = require('path'); const root = path.join(process.cwd(), '../..'); console.log(require('fs').existsSync(path.join(root, 'scripts/legacy/data-processing/extract-bot-tokens-to-clickhouse.ts')))"
```

### 5. Build Test
```bash
cd packages/web
npm run build
```
- Verify production build succeeds
- Check for any build-time errors or warnings

## 🚧 Known TODOs / Incomplete Features

### Mini App Backtest API
**Location:** `app/api/miniapp/backtest/route.ts`
- Currently returns 501 (Not Implemented)
- Needs integration with simulation engine
- Options:
  1. Call bot service API (recommended)
  2. Use local simulation engine

### Mini App Strategies API
**Location:** `app/api/miniapp/strategies/route.ts`
- Database integration needed
- Currently returns empty array
- Need to implement `getUserStrategies()` function

## 🔧 Potential Improvements

### 1. Environment Variables
Update `.env.local` example in README to reflect correct paths:
```env
CALLER_DB_PATH=../../caller_alerts.db  # Updated path
STRATEGY_RESULTS_DB_PATH=../../data/databases/strategy_results.db
DASHBOARD_METRICS_DB_PATH=../../data/databases/dashboard_metrics.db
```

### 2. Path Helper Utility
Consider creating a utility function for consistent path resolution:
```typescript
// lib/utils/paths.ts
export const getProjectRoot = () => path.join(process.cwd(), '../..');
export const getDataDir = () => path.join(getProjectRoot(), 'data');
export const getScriptsDir = () => path.join(getProjectRoot(), 'scripts');
```

### 3. Error Handling
- Add better error messages for missing files/directories
- Add validation for script paths before execution
- Add logging for path resolution issues

### 4. Testing
- Add integration tests for API routes
- Add tests for path resolution
- Add tests for script execution

## 📝 Documentation Updates Needed

1. **README.md** - Update path examples to use `../..` instead of `..`
2. **API Documentation** - Document all API endpoints with examples
3. **Deployment Guide** - Update deployment instructions if needed

## 🎯 Priority Actions

1. **High Priority:**
   - Test development server startup
   - Verify workspace dependencies are linked
   - Test at least 2-3 API routes manually

2. **Medium Priority:**
   - Run production build test
   - Update README with correct paths
   - Create path helper utility

3. **Low Priority:**
   - Implement Mini App backtest integration
   - Add comprehensive tests
   - Improve error handling

## 🐛 If Issues Arise

### Path Resolution Issues
- Check that `process.cwd()` is `packages/web` when running Next.js
- Verify all paths use `../..` to reach project root
- Use absolute paths if relative paths fail

### Workspace Dependency Issues
- Run `npm install` from project root
- Check `package.json` workspace configuration
- Verify `tsconfig.json` path mappings

### Build Errors
- Check TypeScript errors: `npx tsc --noEmit`
- Verify all imports are correct
- Check for missing dependencies

