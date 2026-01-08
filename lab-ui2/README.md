# @quantbot/lab-ui - Lab UI MVP

A web-based UI for building backtest strategies, running backtests, and viewing leaderboards. This package provides a complete MVP implementation with three main screens: Strategy Builder, Runs, and Leaderboards.

## Overview

The Lab UI integrates with the existing `@quantbot/backtest` engine to provide:

- **Strategy Builder**: Create and save ExitPlan configurations (ladder + trailing + indicator exits) as JSON
- **Runs Management**: Configure and execute backtest runs with real-time status tracking
- **Leaderboards**: View caller performance metrics aggregated from backtest results

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Lab UI    │────▶│  DuckDB   │────▶│   CLI       │
│  (Express)  │     │  (Strategies │     │  (Backtest) │
│             │     │   + Runs)     │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
       │                    │                    │
       │                    │                    │
       └────────────────────┴────────────────────┘
                    Results (backtest_call_results)
```

### Data Flow

1. **Strategy Creation**: UI saves ExitPlan JSON → `backtest_strategies` table in DuckDB
2. **Run Initiation**: UI creates run entry → `backtest_runs` table (status: `queued`)
3. **Backtest Execution**: UI spawns CLI process → CLI loads ExitPlan → runs exit-stack engine
4. **Results Storage**: CLI writes results → `backtest_call_results` table (with `run_id`)
5. **Status Updates**: UI polls run status → updates `backtest_runs.status` → displays leaderboard

## Features

### Strategy Builder

- JSON-based ExitPlan editor with validation
- Seed example for quick start
- Save strategies with custom names
- List all saved strategies

### Runs Management

- Select strategy from saved strategies
- Configure date range, interval, fees, slippage, position size
- Optional caller filter
- Real-time status polling (queued → running → done/error)
- View recent runs with status indicators

### Leaderboards

- Select run by `run_id`
- Aggregated caller performance metrics:
  - PnL% (aggregate)
  - Strike rate
  - Median drawdown
  - Total drawdown
- Per-caller drill-down (future enhancement)

## Installation

```bash
# From project root
pnpm install

# Build the package
pnpm --filter @quantbot/lab-ui build
```

## Configuration

### Environment Variables

The Lab UI uses the following environment variables:

- **`DUCKDB_PATH`** (required): Path to the DuckDB database file
  - Default: `data/tele.duckdb` (if not set)
  - This should point to the same DuckDB file used by the main pipeline
  - The UI creates `backtest_strategies` and `backtest_runs` tables automatically

- **`QUANTBOT_CLI`** (optional): Path to the quantbot CLI command
  - Default: `quantbot`
  - Use this if the CLI is installed in a non-standard location or you need to use a wrapper script

- **`PORT`** (optional): Port for the Express server
  - Default: `3111`

### Example `.env` Setup

```bash
# DuckDB path (should match your main pipeline)
DUCKDB_PATH=./data/tele.duckdb

# Optional: Custom CLI path
QUANTBOT_CLI=quantbot

# Optional: Custom port
PORT=3111
```

## Usage

### Development Mode

```bash
# Start the UI server in development mode (with hot reload)
pnpm --filter @quantbot/lab-ui dev
```

The UI will be available at `http://localhost:3111` (or your configured port).

### Production Mode

```bash
# Build the package
pnpm --filter @quantbot/lab-ui build

# Start the server
pnpm --filter @quantbot/lab-ui start
```

## API Endpoints

### Strategies

- **`GET /api/strategies`** - List all saved strategies
- **`POST /api/strategies`** - Create a new strategy
  - Body: `{ name: string, config_json: string }`

### Runs

- **`GET /api/runs`** - List recent backtest runs
- **`GET /api/runs/:runId`** - Get details for a specific run
- **`POST /api/runs`** - Create and start a new backtest run
  - Body: `{ strategy_id, interval, from, to, caller_filter?, taker_fee_bps, slippage_bps, position_usd }`

### Leaderboards

- **`GET /api/leaderboard/:runId`** - Get caller leaderboard for a specific run

## ExitPlan Schema

The ExitPlan JSON structure supports:

- **Ladder Exits**: Multiple take-profit levels with percentage allocations
- **Trailing Stops**: Dynamic stop-loss with activation thresholds
- **Indicator Exits**: Rule-based exits using technical indicators

See `src/exit-plan-schema.ts` for the complete Zod schema definition.

### Example ExitPlan

```json
{
  "ladder": {
    "levels": [
      { "percent": 0.5, "target": 2.0 },
      { "percent": 0.3, "target": 5.0 },
      { "percent": 0.2, "target": 10.0 }
    ]
  },
  "trailing": {
    "activation": { "kind": "percent", "value": 1.5 },
    "stop": { "kind": "percent", "value": 0.5 }
  },
  "indicators": []
}
```

## Database Schema

The UI automatically creates the following tables in DuckDB:

### `backtest_strategies`

- `strategy_id` (TEXT, PRIMARY KEY) - Unique strategy identifier
- `name` (TEXT) - Human-readable strategy name
- `config_json` (TEXT) - ExitPlan JSON configuration
- `created_at` (TIMESTAMP) - Creation timestamp

### `backtest_runs`

- `run_id` (TEXT, PRIMARY KEY) - Unique run identifier
- `strategy_id` (TEXT) - Reference to strategy
- `status` (TEXT) - Run status: `queued`, `running`, `done`, `error`
- `params_json` (TEXT) - Run parameters (JSON)
- `created_at` (TIMESTAMP) - Creation timestamp
- `started_at` (TIMESTAMP) - Start timestamp (nullable)
- `finished_at` (TIMESTAMP) - Completion timestamp (nullable)
- `error_text` (TEXT) - Error message (nullable)

### `backtest_call_results`

This table is created and populated by the backtest engine. The UI reads from it to display leaderboards.

## Integration with Backtest Engine

The Lab UI integrates with `@quantbot/backtest` via the CLI:

1. UI creates a run entry in `backtest_runs` with status `queued`
2. UI spawns `quantbot backtest run` with:
   - `--run-id`: The generated run ID
   - `--strategy exit-stack`: Strategy mode
   - `--strategy-id`: The selected strategy ID
   - Additional parameters (interval, date range, fees, etc.)
3. CLI loads the ExitPlan from DuckDB using `strategy_id`
4. CLI executes the backtest and writes results to `backtest_call_results`
5. UI polls `/api/runs/:runId` to track status updates

## Development

### Project Structure

```
packages/lab-ui/
├── src/
│   ├── api.ts              # Express API routes
│   ├── db.ts               # DuckDB connection helpers
│   ├── schema.ts           # Database schema creation
│   ├── exit-plan-schema.ts # ExitPlan validation (Zod)
│   ├── runner.ts           # CLI process spawning
│   └── server.ts           # Express app setup
├── views/                  # EJS templates
│   ├── strategies.ejs
│   ├── runs.ejs
│   └── leaderboard.ejs
├── public/                 # Static assets
│   ├── strategies.js
│   ├── runs.js
│   ├── leaderboard.js
│   └── style.css
├── package.json
└── tsconfig.json
```

### Adding New Features

1. **New API Route**: Add to `src/api.ts`
2. **New Page**: Create EJS template in `views/` and client JS in `public/`
3. **Database Changes**: Update `src/schema.ts` to create/modify tables

## Troubleshooting

### Database Connection Issues

- Ensure `DUCKDB_PATH` points to a valid DuckDB file
- Check file permissions (read/write access required)
- Verify the database file exists or can be created

### CLI Execution Issues

- Verify `quantbot` CLI is available in PATH (or set `QUANTBOT_CLI`)
- Check that the CLI has access to the same DuckDB file
- Review run error messages in the UI (stored in `backtest_runs.error_text`)

### Strategy Validation Errors

- Ensure ExitPlan JSON matches the schema in `exit-plan-schema.ts`
- Use the "Seed example" button to see a valid example
- Check browser console for validation error details

## See Also

- **[QUICKSTART.md](./QUICKSTART.md)** - Quick setup guide
- **[packages/backtest/README.md](../backtest/README.md)** - Backtest engine documentation
- **[packages/cli/README.md](../cli/README.md)** - CLI documentation

