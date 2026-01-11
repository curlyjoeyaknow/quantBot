# QuantBot Command Handlers Index

## Main Commands

- [[OHLCV Fetch]] - Direct OHLCV data fetching
- [[OHLCV Coverage Analysis]] - Coverage analysis workflows
- [[Optimization Workflow]] - Policy optimization workflows
- [[Backtesting Workflows]] - Backtesting execution workflows

## Handlers by Package

### Artifacts

- [[get-artifact]] - Get artifact by ID
- [[list-artifacts]] - List all artifacts
- [[tag-artifact]] - Tag artifact

### Backtest

- [[baseline]] - Baseline alert backtests
- [[v1-baseline-optimizer]] - Capital-aware optimization
- [[migrate-results]] - Migrate backtest results

### Calls

- [[list-calls]] - List calls from DuckDB

### Experiments

- [[find-by-parameter]] - Find experiments by parameter
- [[get-experiment]] - Get specific experiment
- [[list-experiments]] - List all experiments

### Ingestion

- [[ensure-ohlcv-coverage]] - Ensure OHLCV coverage for tokens
- [[fetch-token-creation-info]] - Fetch token creation info

### Lab

- [[run-lab]] - Run lab experiments

### OHLCV

- [[alert-coverage-map]] - Alert coverage mapping
- [[analyze-detailed-coverage]] - Detailed coverage analysis
- [[coverage-dashboard]] - Interactive coverage dashboard
- [[coverage-map]] - Interval coverage statistics
- [[fetch-from-duckdb]] - Fetch from DuckDB
- [[fetch-ohlcv]] - Direct OHLCV fetch from API
- [[token-lifespan]] - Token lifespan analysis

### Research

- [[batch-simulation]] - Batch simulations
- [[create-cost-model]] - Create cost model
- [[create-execution-model]] - Create execution model
- [[create-risk-model]] - Create risk model
- [[create-snapshot]] - Create data snapshot
- [[leaderboard]] - Simulation leaderboard
- [[list-runs]] - List simulation runs
- [[replay-manifest]] - Generate replay manifest
- [[replay-simulation]] - Replay simulation
- [[run-simulation]] - Run single simulation
- [[show-run]] - Show run details
- [[sweep-simulation]] - Parameter sweep

### Slices

- [[export-slice]] - Export slice
- [[export-slices-for-alerts]] - Export slices for alerts
- [[validate-slice]] - Validate slice

### Storage

- [[migrate-duckdb]] - Run DuckDB migrations
- [[remove-faulty-addresses]] - Remove faulty addresses
- [[validate-addresses]] - Validate addresses

