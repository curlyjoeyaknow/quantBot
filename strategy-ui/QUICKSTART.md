# Quick Start Guide

## Prerequisites

- Python 3.8+
- ClickHouse running (optional - only needed for running simulations)

## Setup

**Step 1: Navigate to the strategy-ui directory**

From the QuantBot repository root:

```bash
cd strategy-ui
```

You should now be in `/home/memez/quantBot/strategy-ui` (or `./strategy-ui` relative to repo root).

**Step 2: Install dependencies**

```bash
pip install -r requirements.txt
```

2. **Set up ClickHouse connection (if running simulations):**
```bash
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_HTTP_PORT=18123  # or CLICKHOUSE_PORT
export CLICKHOUSE_DATABASE=quantbot
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=your_password
```

Or create a `.env` file:
```bash
CLICKHOUSE_HOST=localhost
CLICKHOUSE_HTTP_PORT=18123
CLICKHOUSE_DATABASE=quantbot
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
```

## Running the Server

**Make sure you're in the `strategy-ui` directory first:**

```bash
cd strategy-ui  # if not already there
pwd  # should show: .../quantBot/strategy-ui
```

### Option 1: Using the run script
```bash
chmod +x run.sh
./run.sh
```

### Option 2: Direct uvicorn command
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Option 3: Python module
```bash
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The server will start on **http://localhost:8000**

**Access the Strategy Wizard at:** <http://localhost:8000/strategies/wizard>

## Testing the Installation

1. **Run the golden test:**
```bash
python -m pytest app/tests/test_sim_engine_golden.py -v
```

2. **Open the web UI:**
   - Navigate to http://localhost:8000
   - You should see the Strategies page

## Basic Usage

### 1. Create a Strategy

- Go to http://localhost:8000/strategies/new
- Enter a name (e.g., "Test Strategy")
- Enter strategy JSON (example below)
- Click "Save"

**Example Strategy JSON:**
```json
{
  "entry": {
    "mode": "immediate",
    "delay": {"mode": "none"}
  },
  "exits": {
    "targets": [
      {"size_pct": 50, "profit_pct": 10},
      {"size_pct": 50, "profit_pct": 20}
    ],
    "trailing": {"enabled": false},
    "time_exit": {"enabled": false}
  },
  "stops": {
    "stop_loss_pct": 5,
    "break_even_after_first_target": false
  },
  "execution": {
    "fill_model": "close",
    "fee_bps": 25,
    "slippage_bps": 10
  }
}
```

### 2. Create a Filter (via database or API)

For now, filters need to be inserted directly into DuckDB or via API. A filter should contain a `tokens` array:

```json
{
  "name": "Test Filter",
  "tokens": ["TokenAddress1", "TokenAddress2"]
}
```

**Insert filter via Python:**
```python
import duckdb
conn = duckdb.connect("data/app.duckdb")
import json

filter_id = "filter_test"
filter_data = {
    "name": "Test Filter",
    "tokens": ["So11111111111111111111111111111111111111112"]  # WSOL example
}
conn.execute(
    "INSERT OR REPLACE INTO filters VALUES (?, ?, ?, now())",
    [filter_id, filter_data["name"], json.dumps(filter_data)]
)
```

### 3. Run a Simulation

**Via API:**
```bash
curl -X POST http://localhost:8000/api/runs \
  -H "Content-Type: application/json" \
  -d '{
    "strategy_id": "your_strategy_id",
    "filter_id": "filter_test",
    "interval_seconds": 300,
    "from_ts": "2024-01-01T00:00:00Z",
    "to_ts": "2024-01-02T00:00:00Z"
  }'
```

**Check run status:**
```bash
curl http://localhost:8000/runs
```

## Troubleshooting

### Import Errors
- Make sure you're in the `strategy-ui` directory
- Verify all dependencies are installed: `pip list | grep -E "(fastapi|uvicorn|duckdb|clickhouse)"`

### ClickHouse Connection Errors
- Verify ClickHouse is running: `curl http://localhost:18123/ping`
- Check environment variables are set correctly
- Verify database exists and has `ohlcv_candles` table

### Database Errors
- The DuckDB database is created automatically at `data/app.duckdb`
- If issues persist, delete `data/app.duckdb` and restart

### Port Already in Use
- Change the port: `uvicorn app.main:app --reload --port 8001`
- Or kill the process using port 8000

## Next Steps

- See `README.md` for full documentation
- See `INTEGRATION.md` for integration details
- See `app/services/simulator_spec.md` for strategy specification

