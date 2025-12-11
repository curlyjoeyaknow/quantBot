# @quantbot/web - Web Dashboard Package

**⚠️ This package is not part of the Golden Path.**

This package provides the Next.js web dashboard for visualizing analytics and simulation results.

## Status

- Functional but not actively developed for Golden Path
- Golden Path focuses on CLI-based analytics pipeline
- Dashboard may be useful for visualization but is secondary

## Usage

See main README.md for web dashboard setup.

## Golden Path Alternative

For Golden Path workflows, use CLI scripts and query Postgres/ClickHouse directly:
- `pnpm ingest:telegram` - Ingest Telegram exports
- `pnpm ingest:ohlcv` - Fetch OHLCV data
- `pnpm simulate:calls` - Run simulations
- Query `simulation_results_summary` table for metrics
