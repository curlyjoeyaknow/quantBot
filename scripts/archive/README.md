# Archived Scripts and Modules

This directory contains archived scripts and modules that are no longer actively used in the codebase. These files are preserved for reference and potential future use.

## Archive Date
2025-01-XX

## Archived Items

### Live Trades (`live-trades/`)

**Files:**
- `live-trade-strategies.ts` - Functions to get enabled/disabled strategies for live trade alerts
- `live-trade-database.ts` - Database functions for storing live trade alerts and price cache
- `live-trade-strategies.test.ts` - Unit tests for live trade strategies
- `003_live_trading.sql` - Postgres migration script for live trading tables

**Reason for Archive:**
- Live trading functionality has been deprecated
- These modules used SQLite for storage and should be migrated to `@quantbot/storage` if needed
- The live trading system was replaced by simulation-based workflows

**Original Location:**
- `packages/utils/src/live-trade-strategies.ts`
- `packages/utils/src/live-trade-database.ts`
- `packages/utils/tests/live-trade-strategies.test.ts`
- `scripts/migration/postgres/003_live_trading.sql`

**Dependencies:**
- SQLite3 database (`data/databases/simulations.db`)
- Tables: `live_trade_strategies`, `live_trade_entry_alerts`, `live_trade_price_cache`

### Monitored Tokens (`monitored-tokens/`)

**Files:**
- `monitored-tokens-db.ts` - Functions for storing and retrieving monitored tokens from Postgres
- `002_monitored_tokens.sql` - Postgres migration script for monitored_tokens table

**Reason for Archive:**
- Monitored tokens functionality has been deprecated
- This module used placeholder Postgres implementations and should be migrated to `@quantbot/storage` if needed
- The monitored tokens system was replaced by alert-based tracking

**Original Location:**
- `packages/utils/src/monitored-tokens-db.ts`
- `scripts/migration/postgres/002_monitored_tokens.sql`

**Dependencies:**
- Postgres database (via `@quantbot/storage`)
- Table: `monitored_tokens`

## Notes

- These files are kept for historical reference and potential future migration
- If you need to restore any of this functionality, consider:
  1. Migrating to `@quantbot/storage` repositories
  2. Using the new alert-based tracking system
  3. Reviewing the simulation workflows for similar functionality

## Related Database Tables

The following tables may still exist in the database but are no longer actively used:
- `live_trade_strategies`
- `live_trade_entry_alerts`
- `live_trade_price_cache`
- `monitored_tokens`

If you need to clean up these tables, ensure no active code references them first.

