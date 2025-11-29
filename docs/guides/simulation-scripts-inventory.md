## Legacy Simulation Script Inventory

This note captures how the three most-used scripts structure simulations today. It highlights shared primitives that the reusable engine needs to support so we can delete these bespoke entrypoints later.

### `scripts/analyze-solana-callers-optimized.ts`
- **Purpose:** batch-optimizes dozens of hard-coded strategy variants against a filtered caller dataset (>100 calls, Solana).
- **Data flow:** loads Birdeye candles through `fetchHybridCandles`, calculates technical indicators locally (Ichimoku, RSI/MACD, MAs), exports per-strategy CSVs plus verbose logs streamed to disk.
- **Strategy config:** giant in-file `STRATEGIES` array with fields for hold duration, take-profit/stop loss settings, trailing stop policy, buy-the-dip logic, delayed entries, and feature flags for multi-trade flows.
- **Outputs:** multiple CSV summaries per strategy + log files, plus console progress bars. No hooks for re-using the logic elsewhere.

### `scripts/run-top-strategies-simulation.ts`
- **Purpose:** run the “top 3” optimization candidates on deduplicated Brook caller tokens.
- **Data flow:** reads CSV exports, deduplicates per mint, fetches Birdeye candles, then runs an inline `simulateStrategy` implementation with its own trailing-stop semantics and CSV export routine.
- **Strategy config:** generated combinatorially inside the script; uses bespoke `profitTargets`, `trailingStopPercent`, `trailingStopActivation`, and `minExitPrice`.
- **Outputs:** per-strategy CSV trade logs and aggregate console stats.

### `scripts/simulate-caller.js`
- **Purpose:** simulate trades for one or many callers using data stored in InfluxDB (with Birdeye ingestion fallback) and persist JSON summaries.
- **Data flow:** pulls alerts from `callerTracking`, ensures OHLCV data exists via `ohlcvQuery`/`ohlcvIngestion`, runs imperative loop per candle with take-profit sequencing and stop-loss handling, then updates caller success rates.
- **Strategy config:** inline constants for entry, stop, and three fixed take-profit levels; includes optional re-entry scaffolding though disabled by default.
- **Outputs:** JSON file per caller plus console narration; mutates caller stats in SQLite.

### Common Steps Across Scripts
- **Input selection:** each script builds a token list (from CSV, DB, or caller alerts) but ultimately needs a uniform “scenario” (mint, chain, start/end).
- **Candle acquisition:** all paths rely on `fetchHybridCandles` or downstream services that still source Birdeye data, with caching/DB fallbacks.
- **Strategy execution:** each script embeds its own simulator even though `src/simulate.ts` already exposes overlapping logic.
- **Result sinks:** CSV, JSON, and DB outputs are hard-coded, forcing new scripts for each reporting format.

These overlaps inform the requirements for the new parameterized engine: it needs configurable data sources, rich strategy definitions (matching all of the knobs above), and pluggable sinks so future workflows don’t require new ad-hoc scripts.

