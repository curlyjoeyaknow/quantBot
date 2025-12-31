# Strategy Simulator UI

FastAPI + HTMX skeleton for the QuantBot Strategy Simulator with deterministic simulation engine.

## Setup

### Step 1: Navigate to the strategy-ui directory

```bash
cd /home/memez/quantBot/strategy-ui
# or from repo root:
cd strategy-ui
```

### Step 2: Install dependencies

```bash
pip install -r requirements.txt
```

### Step 3: Configure ClickHouse connection (optional - only needed for running simulations)

```bash
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_HTTP_PORT=18123
export CLICKHOUSE_DATABASE=quantbot
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=your_password
```

Or create a `.env` file in the `strategy-ui` directory:

```bash
CLICKHOUSE_HOST=localhost
CLICKHOUSE_HTTP_PORT=18123
CLICKHOUSE_DATABASE=quantbot
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
```

### Step 4: Run the server

From the `strategy-ui` directory:

```bash
./run.sh
# or
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Step 5: Open the web UI

Navigate to <http://localhost:8000> in your browser

### Access the Strategy Wizard

Go to <http://localhost:8000/strategies/wizard>

## Structure

- `app/main.py` - FastAPI routes and application setup
- `app/db.py` - DuckDB connection and schema initialization
- `app/models.py` - Pydantic models for validation
- `app/services/` - Simulation engine and services
  - `simulator_spec.md` - Locked contract specification
  - `sim_engine.py` - Core deterministic engine
  - `run_execute.py` - ClickHouse integration and run execution
  - `sim_types.py` - Event and Trade dataclasses
  - `indicators.py` - RSI and EMA implementations
  - `strategy_validate.py` - Pre-simulation validation
- `app/templates/` - Jinja2 HTML templates
- `app/static/` - Static files (CSS, JS)
- `data/app.duckdb` - DuckDB database (created on first run)

## Features

### Deterministic Simulation Engine

- Event-native architecture
- Replay-friendly frames
- Intra-candle ordering (conservative_long)
- Strategy validation

### ClickHouse Integration

- OHLCV candle loading
- Environment-based configuration
- Supports intervals: 15s, 1m, 5m, 15m, 1h, 4h, 1d

### FastAPI + HTMX UI

- Strategy CRUD
- Run management
- Form-based strategy creation
- Strategy Builder Wizard (5-step guided process)

## Usage

### Creating a Strategy

#### Quick Start: Use Example Strategies

1. Check `examples/` directory for ready-to-use strategy JSON files
2. Copy the JSON from an example file
3. Navigate to <http://localhost:8000/strategies/new>
4. Paste the JSON into the textarea
5. Enter a name (or use the one from the example)
6. Save

#### Using the Strategy Wizard (Recommended)

1. Navigate to <http://localhost:8000/strategies/wizard>
2. Fill out the 5-step wizard (Entry → Risk → Profit → Time → Execution)
3. Review the strategy summary
4. Optionally view/edit the JSON
5. Enter a strategy name
6. Save

#### Manual Creation

1. Navigate to <http://localhost:8000/strategies/new>
2. Enter strategy name
3. Enter strategy JSON (see `examples/` for templates or `simulator_spec.md` for format)
4. Save

### Creating a Filter

Filters define which tokens to simulate. For now, use direct token lists:

```json
{
  "tokens": ["TokenAddress1", "TokenAddress2"]
}
```

### Running a Simulation

POST to `/api/runs` with:

```json
{
  "strategy_id": "your_strategy_id",
  "filter_id": "your_filter_id",
  "interval_seconds": 300,
  "from_ts": "2024-01-01T00:00:00Z",
  "to_ts": "2024-01-02T00:00:00Z"
}
```

## Testing

Run the golden test:

```bash
python -m pytest app/tests/test_sim_engine_golden.py -v
```

## Next Steps

- [ ] SSE replay endpoint (`/api/replay/stream`)
- [ ] Canvas candle renderer for replay visualization
- [ ] Full FilterPreset token resolution
- [ ] Background execution (async/queue)
- [ ] Parameter sweep / batch runs

See `INTEGRATION.md` for detailed integration guide.
