# QuantBot Backtest Tools

Simple, interactive tools for running backtests and viewing reports.

## 🚀 Quick Start

### Interactive CLI Menu

```bash
python3 tools/backtest/interactive_cli.py --duckdb data/alerts.duckdb
```

This provides a simple menu-driven interface:
- **Run Baseline Backtest** - Guided workflow for running backtests
- **View Reports** - Browse all backtest runs
- **Open Web Dashboard** - Launch the visual dashboard

### Web Dashboard

Start the report server:

```bash
python3 tools/backtest/report_server.py --duckdb data/alerts.duckdb
```

Then open your browser to:
- **Home**: `http://localhost:8080/` - List all runs
- **Dashboard**: `http://localhost:8080/api/dashboard` - Query builder with filters

## 📊 Dashboard Features

The dashboard provides a **Query Builder** to answer questions like:

### Example Queries

1. **Filter alerts by market cap:**
   - Set "Max Market Cap" to `50000`
   - Click "Run Query"
   - See: % of alerts that go 2x, 3x, or break 100k+

2. **Filter by caller:**
   - Enter caller name in "Caller" field
   - Click "Run Query"
   - See: That caller's performance metrics

3. **Filter by run:**
   - Select a specific run from dropdown
   - Click "Run Query"
   - See: Results for that specific backtest run

### Query Results

The dashboard shows:
- **Total Alerts** - Number of alerts matching filters
- **Hit 2x** - Percentage that reached 2x price
- **Hit 3x** - Percentage that reached 3x price
- **Hit 100k+** - Percentage that broke $100k market cap

## 🔌 API Endpoints

### Query API

```
GET /api/query?run_id=<id>&caller=<name>&max_mcap=<number>&run_type=baseline
```

Returns JSON with:
```json
{
  "filters": {
    "run_id": "...",
    "caller": "...",
    "max_mcap": "50000",
    "run_type": "baseline"
  },
  "metrics": {
    "total_alerts": 150,
    "hit_2x": 45,
    "hit_3x": 20,
    "hit_100k": 12,
    "pct_2x": 30.0,
    "pct_3x": 13.33,
    "pct_100k": 8.0
  }
}
```

### Analytics API

```
GET /api/analytics?run_id=<id>&max_mcap=<number>&run_type=baseline
```

Returns caller performance breakdown:
```json
{
  "callers": [
    {
      "caller": "caller1",
      "total_calls": 50,
      "hit_2x": 20,
      "hit_3x": 10,
      "pct_2x": 40.0,
      "pct_3x": 20.0,
      "avg_ath_mult": 2.5
    }
  ]
}
```

## 📝 Examples

### Answer: "What % of alerts under $50k market cap go 2x?"

```bash
# Using dashboard:
# 1. Open http://localhost:8080/api/dashboard
# 2. Enter "50000" in "Max Market Cap"
# 3. Click "Run Query"
# 4. See "Hit 2x" percentage

# Or using API:
curl "http://localhost:8080/api/query?max_mcap=50000&run_type=baseline"
```

### Answer: "What % of alerts from caller X go 3x?"

```bash
# Using dashboard:
# 1. Enter caller name in "Caller" field
# 2. Click "Run Query"
# 3. See "Hit 3x" percentage

# Or using API:
curl "http://localhost:8080/api/query?caller=caller_name&run_type=baseline"
```

## 🛠️ Advanced Usage

### Custom Filters

You can combine filters:
- Market cap + Caller
- Run ID + Caller
- All filters together

### Batch Queries

Use the API endpoints for automation:

```bash
# Get all caller stats
curl "http://localhost:8080/api/analytics?run_type=baseline" | jq

# Query specific run
curl "http://localhost:8080/api/query?run_id=<id>&run_type=baseline" | jq
```

## 📖 Architecture

- **Interactive CLI** (`interactive_cli.py`) - Menu-driven interface
- **Report Server** (`report_server.py`) - Web dashboard and API
- **Query Engine** - Filters data from DuckDB and calculates metrics
- **Dashboard UI** - Visual query builder and results display

## 🔧 Configuration

Default paths:
- **DuckDB**: `data/alerts.duckdb`
- **Slices**: `slices/per_token/`
- **Port**: `8080`

Override with flags:
```bash
python3 tools/backtest/report_server.py \
  --duckdb data/alerts.duckdb \
  --slices-dir slices/per_token \
  --port 8080
```

