# Legacy Code Archive

This directory contains the old architecture code that predates the Golden Path refactor.

## Structure

- `src/` - Copy of the old monolithic `src/` directory
- `scripts/` - Old scripts that depend on the old `src/` structure

## Migration Status

**Everything in here is old architecture. New code lives in `packages/*` + `scripts/*`.**

### What's Legacy

- Old `src/` directory structure (monolithic, mixed concerns)
- SQLite-based database code in `utils/database.ts`
- Scripts that import from `../src` instead of `@quantbot/*` packages
- Old simulation code that hasn't been migrated to the new engine

### What's New (Golden Path)

- `packages/utils` - Clean utilities (logger, config, types)
- `packages/storage` - Typed repositories for Postgres/ClickHouse
- `packages/simulation` - Pure simulation engine
- `packages/services` - Business logic services
- `scripts/ingest/` - New ingestion scripts
- `scripts/simulation/` - New simulation scripts

## No New Code Here

**Do not add new code to this directory.** All new development should happen in:
- `packages/*` for reusable modules
- `scripts/*` for CLI tools

## Rollback

If you need to rollback to the pre-refactor state:
```bash
git checkout pre-golden-path-refactor
```

This tag was created before the Golden Path refactor began.

