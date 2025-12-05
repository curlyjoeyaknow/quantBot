# Project Structure Summary

## Directory Organization

```
quantBot/
├── packages/                    # All packages (monorepo structure)
│   ├── utils/                   # @quantbot/utils - Shared utilities
│   │   ├── src/
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── storage/                 # @quantbot/storage - Storage layer
│   ├── simulation/              # @quantbot/simulation - Trading engine
│   ├── services/                # @quantbot/services - Business logic
│   ├── monitoring/              # @quantbot/monitoring - Stream services
│   ├── bot/                     # @quantbot/bot - Telegram bot
│   └── web/                     # @quantbot/web - Next.js dashboard
│
├── scripts/                     # Utility scripts (use package imports)
├── tests/                       # Shared test utilities
│   ├── setup.ts
│   ├── jest-shim.ts
│   └── jest-globals.ts
│
├── data/                        # Runtime data (databases, cache, exports)
│   ├── *.db                     # SQLite databases
│   ├── cache/                   # Cached data
│   ├── exports/                 # Generated reports/exports
│   └── raw/                     # Raw data files
│
├── docs/                        # Documentation
│   ├── modularization.md        # Package architecture
│   ├── testing.md               # Testing strategy
│   └── package-migration-guide.md
│
├── templates/                   # Template files
├── cache/                       # Temporary cache
│
├── .cursorrules                 # Cursor IDE rules (updated for packages)
├── package.json                 # Root workspace config
├── tsconfig.json                # Root TypeScript config
└── vitest.config.ts             # Root test config
```

## Database Files

Database files remain at the root level and are referenced using `process.cwd()`:

- `simulations.db` - Simulation runs and strategies
- `quantbot.db` - Main application database
- `data/caller_alerts.db` - Caller alerts
- `data/dashboard_metrics.db` - Dashboard metrics
- `data/strategy_results.db` - Strategy results
- `data/unified_calls.db` - Unified calls data

All database paths use `process.cwd()` to ensure they work from any package location.

## Key Files Updated

### Configuration Files
- ✅ `.cursorrules` - Updated to reference packages
- ✅ `package.json` - Added workspaces configuration
- ✅ `tsconfig.json` - Added package path mappings
- ✅ `packages/*/tsconfig.json` - Package-specific configs
- ✅ `packages/*/vitest.config.ts` - Package test configs

### Scripts
- ✅ `scripts/setup-clickhouse.ts` - Updated imports
- ✅ `scripts/migrate-csv-to-clickhouse.ts` - Updated imports
- ✅ `scripts/simulation/run-engine.ts` - Updated imports
- ✅ `scripts/run-all-strategies-gauntlet.ts` - Updated imports
- ✅ `scripts/extract-all-calls-september-onwards.ts` - Updated imports
- ✅ `scripts/test-chat-extraction-engine.ts` - Updated imports

### Remaining Scripts to Update
- `scripts/analysis/*.ts` - May need import updates
- `scripts/data-processing/*.ts` - May need import updates
- `scripts/legacy/*` - Legacy scripts (lower priority)

## Package Dependencies

```
@quantbot/utils (base)
  └── No internal dependencies

@quantbot/storage
  └── @quantbot/utils

@quantbot/simulation
  └── @quantbot/utils
  └── @quantbot/storage

@quantbot/services
  └── @quantbot/utils
  └── @quantbot/storage
  └── @quantbot/simulation

@quantbot/monitoring
  └── @quantbot/utils
  └── @quantbot/storage

@quantbot/bot
  └── All other packages

@quantbot/web
  └── All other packages
```

## Testing Structure

Each package has its own tests:
- `packages/{name}/tests/` - Package-specific tests
- `packages/{name}/vitest.config.ts` - Package test configuration
- Root `tests/` - Shared test utilities and setup

## Next Steps

1. ✅ Packages created and organized
2. ✅ Tests moved to packages
3. ✅ Key scripts updated
4. ⚠️ Remaining scripts need import updates (see migration guide)
5. ⚠️ Some test imports need updating
6. ⚠️ Web package may need import updates
7. ⚠️ Consider creating `@quantbot/api` package for API clients
8. ⚠️ Consider creating `@quantbot/types` package for shared types

