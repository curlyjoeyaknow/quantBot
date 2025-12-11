# @quantbot/trading - Live Trading Package

**⚠️ This package is not part of the Golden Path.**

**Live trading execution should be moved to a separate execution repository.**

This package contains code for live trading execution on Solana. It is kept here for reference but is not part of the Golden Path analytics pipeline.

## Status

- Reference implementation only
- Should be moved to separate "execution" repo
- Golden Path is analytics-only (no wallet keys, no RPC sending, no live trading)

## Golden Path Principle

The Golden Path is **analytics and backtesting only**:
- ✅ Ingest Telegram exports
- ✅ Fetch OHLCV data
- ✅ Run simulations
- ❌ No wallet keys
- ❌ No RPC sending
- ❌ No live trading decisions
- ❌ No bot-driven execution

Live trading belongs in a separate repository that consumes:
- Calls from Postgres
- Strategies from Postgres
- Performance stats (optional)
