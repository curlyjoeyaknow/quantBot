# @quantbot/lab

Research Lab Package - Feature computation, strategy compilation, simulation, and optimization.

## Features

- **Feature Computation** - Indicator registry, feature set compilation, caching
- **Strategy Compilation** - Graph-based strategy compilation and condition evaluation
- **Simulation Kernel** - Pure compute simulation engine
- **Risk Engine** - Risk management and circuit breakers
- **Optimization** - Grid search, random search, parameter space exploration
- **Metrics** - Stability scoring and performance metrics
- **Rolling Windows** - Time-windowed execution

## Self-Contained Web UI

The lab package includes a simple Fastify-based web UI that doesn't depend on the Next.js web package.

### Running the Server

```bash
# Build the package first
pnpm --filter @quantbot/lab build

# Run the server (production)
pnpm --filter @quantbot/lab server

# Or in development mode (with auto-reload)
pnpm --filter @quantbot/lab dev

# Or set a custom port
PORT=3002 pnpm --filter @quantbot/lab server
```

The server will start on `http://localhost:3001` (or the port specified in `PORT` environment variable).

Open your browser to `http://localhost:3001` to view the lab dashboard.

### UI Features

The lab dashboard includes multiple tabs:

1. **Leaderboard** - Top performing strategies ranked by PnL, stability, or Pareto frontier
2. **Strategies** - View all registered strategies with their versions, categories, and status
3. **Simulations** - Browse simulation runs with status, engine versions, and timestamps
4. **Feature Sets** - View compiled feature sets and their associated data slices
5. **Optimization** - Monitor optimization jobs and their candidate exploration results
6. **Data Slices** - Browse available data slices (Parquet files) used for research

### API Endpoints (Resource Model)

The API follows a resource-based model where URLs reflect actual resources. See [API.md](./API.md) for complete documentation.

#### Quick Reference

**Backtest Endpoints:**
- `POST /backtest` - Start a backtest (returns `{ runId }` immediately, runs asynchronously)
- `POST /backtest/dry-run` - Validate backtest config and get estimated cost/time

**Runs Endpoints:**
- `GET /runs` - List runs with cursor pagination (filters: status, strategyId, timeframe, from, to)
- `GET /runs/:runId` - Get run details and summary
- `GET /runs/:runId/logs` - Get run-scoped logs (cursor paginated)
- `GET /runs/:runId/artifacts` - Get artifact references (parquet, CSV, JSON)
- `GET /runs/:runId/metrics` - Get time-series metrics (drawdown, exposure, fills)

**Leaderboard Endpoints:**
- `GET /leaderboard` - Ranked view over runs (query: metric, timeframe, strategyId, window, limit)
- `GET /leaderboard/strategies` - Strategy-level aggregated leaderboard

**Strategies Endpoints:**
- `GET /strategies` - List all strategies
- `GET /strategies/:id` - Get strategy details (with optional `?version=` query param)
- `POST /strategies` - Create new strategy version
- `PATCH /strategies/:id` - Update strategy metadata
- `POST /strategies/:id/validate` - Validate strategy config schema

**Statistics Endpoints:**
- `GET /statistics/overview` - Overview totals (runs, tokens, avg PnL, win rate)
- `GET /statistics/pnl` - PnL statistics (groupBy: day/week/token/caller/strategy)
- `GET /statistics/distribution` - Distribution histograms
- `GET /statistics/correlation` - Feature correlations

**Legacy Endpoints (Backward Compatibility):**
- `GET /api/leaderboard` - Redirects to `/leaderboard`
- `GET /api/strategies` - Redirects to `/strategies`
- `GET /api/simulation-runs` - Redirects to `/runs`
- `GET /api/health` - Health check

For detailed API documentation including request/response formats, examples, and error handling, see [API.md](./API.md).

### Features

- **Cursor-Based Pagination** - All list endpoints use `cursor` and return `nextCursor`
- **Run-Scoped Logging** - Each run has its own log stream accessible via `/runs/:runId/logs`
- **Async Execution** - Backtests run asynchronously, status tracked via run endpoints
- **Resource Semantics** - URLs reflect actual resources (runs, strategies, etc.)

## Architecture

The lab package is self-contained and doesn't depend on the web package. It provides:

1. **Core Lab Logic** - All research lab functionality
2. **Simple Web UI** - Fastify server with basic HTML/CSS/JS
3. **Direct Storage Access** - Uses `@quantbot/storage` directly

This keeps the lab package independent and allows it to be used standalone or integrated into other applications.

