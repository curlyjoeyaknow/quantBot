# QuantBot Backtest Tools - Usage Guide

## 🚀 Quick Start

### Start Report Server

```bash
# Basic usage (defaults: data/alerts.duckdb, port 8080)
python3 tools/backtest/report_server.py

# Custom DuckDB path
python3 tools/backtest/report_server.py --duckdb data/alerts.duckdb

# Custom port
python3 tools/backtest/report_server.py --port 8080

# Custom slices directory
python3 tools/backtest/report_server.py --slices-dir slices/per_token

# Full example
python3 tools/backtest/report_server.py \
  --duckdb data/alerts.duckdb \
  --slices-dir slices/per_token \
  --port 8080 \
  --host 0.0.0.0
```

### Access Dashboard

Once the server is running:

1. **Home Page** (List all runs):
   ```
   http://localhost:8080/
   ```

2. **View Specific Run**:
   ```
   http://localhost:8080/run/{run_id}?type=baseline
   ```

3. **Baseline Dashboard** (Truth-layer, all alerts):
   ```
   http://localhost:8080/baseline
   ```

4. **Query Builder**:
   ```
   http://localhost:8080/api/dashboard
   ```

## 📊 Baseline Dashboard

The baseline dashboard shows **raw price action** (no trading strategies):

- **Caller Leaderboard**: All callers with metrics (% 2x, % 3x, % 5x, % 10x, drawdowns)
- **Click any caller**: View their alerts and performance charts
- **Data source**: Queries from `canon.alerts_std` (all alerts)

**Features:**
- Processes ALL alerts (no limits)
- Cached to Parquet for fast access
- Batched queries (1000 alerts per batch)

## 🔍 Query API

### Query Alerts

```bash
# Get all alerts
curl "http://localhost:8080/api/query?run_type=baseline"

# Filter by caller
curl "http://localhost:8080/api/query?caller=caller_name&run_type=baseline"

# Filter by market cap
curl "http://localhost:8080/api/query?max_mcap=50000&run_type=baseline"

# Filter by run ID
curl "http://localhost:8080/api/query?run_id=abc123&run_type=baseline"
```

### Analytics API

```bash
# Get caller performance breakdown
curl "http://localhost:8080/api/analytics?run_type=baseline"

# With filters
curl "http://localhost:8080/api/analytics?run_id=abc123&max_mcap=50000"
```

## 🛠️ Troubleshooting

### Port Already in Use

```bash
# Kill all processes on port 8080
lsof -ti:8080 | xargs kill -9

# Or kill all report_server processes
pkill -f "python.*report_server"
```

### Clear Cache

```bash
# Clear report cache
rm -rf results/cached_reports/*.html

# Clear alerts cache
rm -rf results/cached_alerts/*.parquet
```

### DuckDB Lock Error

The server automatically retries on lock conflicts. If persistent:

```bash
# Check what's locking the database
lsof data/alerts.duckdb

# Kill the locking process
kill -9 <PID>
```

## 📝 Examples

### Answer: "What % of alerts under $50k go 2x?"

1. Open dashboard: `http://localhost:8080/api/dashboard`
2. Enter `50000` in "Max Market Cap"
3. Click "Run Query"
4. See "Hit 2x" percentage

### Answer: "What % of alerts from caller X go 3x?"

1. Open dashboard: `http://localhost:8080/api/dashboard`
2. Enter caller name in "Caller" field
3. Click "Run Query"
4. See "Hit 3x" percentage

### View All Alerts by Caller

1. Open baseline dashboard: `http://localhost:8080/baseline`
2. See caller leaderboard
3. Click any caller to drill down

## 🔧 Configuration

### Default Paths

- **DuckDB**: `data/alerts.duckdb`
- **Slices**: `slices/per_token/`
- **Port**: `8080`
- **Host**: `0.0.0.0` (all interfaces)

### Environment Variables

```bash
export DUCKDB_PATH=data/alerts.duckdb
python3 tools/backtest/report_server.py  # Uses DUCKDB_PATH
```

## 📈 Performance

- **Report Generation**: Cached after first generation
- **Alerts Loading**: Batched (1000 per batch)
- **Cache Duration**: 1 hour for alerts, permanent for reports
- **Multiprocessing**: Parallel trade processing (all CPU cores)

## 🎯 Key Features

✅ **No limits** - Processes ALL alerts and trades  
✅ **Batched queries** - Handles large datasets efficiently  
✅ **Caching** - Fast repeated access  
✅ **Lock handling** - Graceful retry on DuckDB locks  
✅ **Baseline dashboard** - Truth-layer metrics (no strategies)  
✅ **Query builder** - Filter by market cap, caller, run ID  

