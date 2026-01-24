# QuantBot Command Handlers Index

> **Last Updated**: 2025-01-24  
> **Pattern**: All commands use `defineCommand()` wrapper with Zod validation and handler pattern

## Main Commands

- [[OHLCV Fetch]] - Direct OHLCV data fetching
- [[OHLCV Coverage Analysis]] - Coverage analysis workflows
- [[Optimization Workflow]] - Policy optimization workflows
- [[Backtesting Workflows]] - Backtesting execution workflows

## Handlers by Package

### Analytics

- `analytics analyze` - Analyze analytics data
- `analytics analyze-duckdb` - Analyze DuckDB analytics
- `analytics metrics` - Analytics metrics operations
- `analytics report` - Generate analytics reports

### API Clients

- `api-clients credits` - Check API credits
- `api-clients status` - Check API client status

### Architecture

- `architecture verify-boundaries` - Verify architectural boundaries
- `architecture test-boundaries` - Test boundary enforcement

### Artifacts

- [[list-artifacts]] - List all artifacts
- [[get-artifact]] - Get artifact by ID
- [[tag-artifact]] - Tag artifact

### Backtest

- [[baseline]] - Baseline alert backtests
- `backtest run` - Run backtest workflow
- `backtest callers` - Caller analysis
- `backtest list` - List backtest runs
- `backtest leaderboard` - Backtest leaderboard
- `backtest truth-leaderboard` - Truth metrics leaderboard
- `backtest policy` - Policy backtest execution
- `backtest optimize` - Policy optimization
- [[v1-baseline-optimizer]] - Capital-aware optimization
- [[migrate-results]] - Migrate backtest results

### Calls

- `calls evaluate` - Evaluate calls
- [[list-calls]] - List calls from DuckDB
- `calls export` - Export calls
- `calls export-simulation` - Export calls with simulation data
- `calls sweep` - Sweep calls with parameters

### Data (Canonical)

- [[canonical-query]] - Query canonical events
- [[canonical-get-by-asset]] - Get canonical events by asset

### Data (Raw)

- [[raw-list]] - List raw data sources
- [[raw-query]] - Query raw immutable data

### Experiments

- [[find-by-parameter]] - Find experiments by parameter
- [[get-experiment]] - Get specific experiment
- [[list-experiments]] - List all experiments

### Features

- [[list-features]] - List registered features
- [[compute-features]] - Compute features for feature set

### Ingestion

- `ingestion telegram` - Ingest Telegram export
- `ingestion ohlcv` - Ingest OHLCV data
- `ingestion telegram-python` - Telegram ingestion via Python
- `ingestion validate-addresses` - Validate addresses
- `ingestion surgical-fetch` - Surgical OHLCV fetch
- [[ensure-ohlcv-coverage]] - Ensure OHLCV coverage for tokens
- [[fetch-token-creation-info]] - Fetch token creation info
- `ingestion market-data` - Ingest market data

### Lab

- [[run-lab]] - Run lab experiments
- `lab sweep` - Lab parameter sweep
- `lab export-parquet` - Export lab results to Parquet

### Lab UI

- [[lab-ui]] - Start Lab UI server

### Lake

- [[export-run-slices]] - Export run-scoped slices to Parquet Lake v1 format

### Metadata

- `metadata resolve-evm-chains` - Resolve EVM chain metadata

### Observability

- `observability health` - Health check
- `observability quotas` - Check quotas
- `observability errors` - Error tracking

### OHLCV

- `ohlcv query` - Query OHLCV candles
- `ohlcv fetch` - Fetch OHLCV from API
- [[fetch-from-duckdb]] - Fetch from DuckDB
- `ohlcv backfill` - Backfill OHLCV data
- `ohlcv coverage` - Coverage analysis
- `ohlcv analyze-coverage` - Analyze coverage statistics
- [[analyze-detailed-coverage]] - Detailed coverage analysis
- [[coverage-map]] - Interval coverage statistics
- [[alert-coverage-map]] - Alert coverage mapping
- [[coverage-dashboard]] - Interactive coverage dashboard
- [[token-lifespan]] - Token lifespan analysis
- `ohlcv dedup-sweep` - Deduplication sweep
- `ohlcv runs-list` - List OHLCV ingestion runs
- `ohlcv runs-rollback` - Rollback OHLCV ingestion run
- `ohlcv runs-details` - Get run details
- `ohlcv validate-duplicates` - Validate duplicate candles

### Research

- [[run-simulation]] - Run single simulation
- [[batch-simulation]] - Batch simulations
- [[sweep-simulation]] - Parameter sweep
- [[replay-simulation]] - Replay simulation
- [[replay-manifest]] - Replay from manifest.json
- [[list-runs]] - List simulation runs
- [[show-run]] - Show run details
- [[leaderboard]] - Simulation leaderboard
- [[create-snapshot]] - Create data snapshot
- [[create-execution-model]] - Create execution model
- [[create-cost-model]] - Create cost model
- [[create-risk-model]] - Create risk model

### Server

- [[serve]] - Start API server

### Simulation

- `simulation run` - Run simulation
- `simulation list-runs` - List simulation runs
- `simulation list-strategies` - List strategies
- `simulation leaderboard` - Simulation leaderboard
- `simulation store-strategy-duckdb` - Store strategy in DuckDB
- `simulation store-run-duckdb` - Store run in DuckDB
- `simulation run-simulation-duckdb` - Run simulation with DuckDB
- `simulation clickhouse-query` - Query ClickHouse for simulation
- `simulation generate-report-duckdb` - Generate DuckDB report

### Slices

- [[export-slice]] - Export slice
- [[export-slices-for-alerts]] - Export slices for alerts
- [[validate-slice]] - Validate slice

### Storage

- `storage query` - Query storage
- `storage stats` - Storage statistics
- `storage tokens` - Token operations
- `storage stats-workflow` - Stats workflow
- `storage ohlcv-stats` - OHLCV statistics
- `storage token-stats` - Token statistics
- [[validate-addresses]] - Validate addresses
- [[migrate-duckdb]] - Run DuckDB migrations
- `storage analyze-duplicates` - Analyze duplicate candles
- `storage deduplicate` - Deduplicate candles
- `storage analyze-quality` - Analyze candle quality
- [[remove-faulty-addresses]] - Remove faulty addresses

### Telegram

- `telegram` - Telegram operations

### Validation

- `validation verify-ohlcv-fetch` - Verify OHLCV fetch operations

## Command Patterns

### Handler Pattern

All handlers follow the pure function pattern:
- Located in `packages/cli/src/handlers/{package}/{command-name}.ts`
- Pure function: `(args: ValidatedArgs, ctx: CommandContext) => Promise<Result>`
- No console.log, no process.exit, no try/catch
- Returns data only (formatting handled by executor)

### Command Registration Pattern

Commands use `defineCommand()` wrapper:
```typescript
defineCommand(command, {
  name: 'command-name',
  packageName: 'package',
  validate: (opts) => schema.parse(opts),
  handler: handlerFunction,
});
```

### Command Context Pattern

Handlers access services via `CommandContext`:
```typescript
const service = ctx.services.serviceName();
return await service.method(args);
```

### Dataset Registry Pattern (Phase 4)

Slice export uses centralized dataset registry:
- `datasetRegistry.get(datasetId)` - Get dataset metadata
- `datasetRegistry.isAvailable(datasetId)` - Check conditional availability
- Supported datasets: `candles_1s`, `candles_15s`, `candles_1m`, `candles_5m`, `indicators_1m`

