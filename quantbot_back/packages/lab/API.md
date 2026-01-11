# Lab API Documentation

Complete API reference for the Lab research interface.

## Base URL

```
http://localhost:3001
```

## Authentication

Currently no authentication is required. All endpoints are publicly accessible.

---

## Resource Model

The API follows RESTful resource semantics:

- **Backtest** - Execution request that creates Runs
- **Run** - Immutable result record with status, logs, artifacts, and metrics
- **Leaderboard** - Ranked view over runs
- **Strategies** - Stored strategy configurations and versions
- **Statistics** - Aggregated statistics over runs

---

## Backtest Endpoints

### POST /backtest

Start a new backtest simulation run.

**Request Body:**
```json
{
  "strategyId": "momentum-v1",
  "strategyVersion": "1.0.0",
  "universe": {
    "type": "tokens",
    "mints": ["7pXs123456789012345678901234567890pump"]
  },
  "timeframe": {
    "from": "2024-01-01T00:00:00Z",
    "to": "2024-01-31T23:59:59Z"
  },
  "config": {
    "entry": { /* strategy-specific config */ },
    "exit": { /* strategy-specific config */ }
  }
}
```

**Response:**
```json
{
  "runId": "run-1704067200000-abc123",
  "status": "queued",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Status Codes:**
- `201 Created` - Backtest queued successfully
- `400 Bad Request` - Invalid request body
- `500 Internal Server Error` - Server error

**Notes:**
- Returns immediately with `runId`
- Simulation runs asynchronously
- Check status via `GET /runs/:runId`
- View logs via `GET /runs/:runId/logs`

---

### POST /backtest/dry-run

Validate backtest configuration and get estimated cost/time without executing.

**Request Body:** Same as `POST /backtest`

**Response:**
```json
{
  "valid": true,
  "estimatedCost": {
    "calls": 100,
    "tokens": 5,
    "estimatedTimeSeconds": 120
  },
  "resolvedConfig": {
    /* Full resolved configuration */
  }
}
```

**Status Codes:**
- `200 OK` - Validation successful
- `400 Bad Request` - Invalid configuration
- `500 Internal Server Error` - Server error

---

## Run Endpoints

### GET /runs

List simulation runs with filtering and cursor-based pagination.

**Query Parameters:**
- `status` (optional) - Filter by status: `queued`, `running`, `completed`, `failed`
- `strategyId` (optional) - Filter by strategy ID
- `limit` (optional, default: 50) - Number of results per page
- `cursor` (optional) - Pagination cursor from previous response

**Response:**
```json
{
  "runs": [
    {
      "runId": "run-1704067200000-abc123",
      "status": "completed",
      "strategyId": "momentum-v1",
      "strategyVersion": "1.0.0",
      "createdAt": "2024-01-01T00:00:00Z",
      "startedAt": "2024-01-01T00:00:01Z",
      "completedAt": "2024-01-01T00:02:00Z",
      "summary": {
        "callsFound": 100,
        "callsSucceeded": 95,
        "callsFailed": 5,
        "trades": 10,
        "totalPnl": 1000.5,
        "maxDrawdown": -50.2,
        "sharpeRatio": 1.5,
        "winRate": 0.6
      }
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTAxVDAwOjAwOjAwWiJ9" // or null
}
```

**Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid query parameters
- `500 Internal Server Error` - Server error

**Notes:**
- Results ordered by `createdAt` DESC (newest first)
- Use `nextCursor` for pagination
- Combines data from `run_status` table and legacy `simulation_runs` table

---

### GET /runs/:runId

Get detailed information for a specific run.

**Path Parameters:**
- `runId` - The run ID (e.g., `run-1704067200000-abc123`)

**Response:**
```json
{
  "runId": "run-1704067200000-abc123",
  "status": "completed",
  "strategyId": "momentum-v1",
  "strategyVersion": "1.0.0",
  "createdAt": "2024-01-01T00:00:00Z",
  "startedAt": "2024-01-01T00:00:01Z",
  "completedAt": "2024-01-01T00:02:00Z",
  "config": {
    "universe": { /* ... */ },
    "timeframe": { /* ... */ }
  },
  "summary": {
    "callsFound": 100,
    "callsSucceeded": 95,
    "callsFailed": 5,
    "trades": 10,
    "totalPnl": 1000.5,
    "maxDrawdown": -50.2,
    "sharpeRatio": 1.5,
    "winRate": 0.6
  },
  "error": null
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Run not found
- `500 Internal Server Error` - Server error

---

### GET /runs/:runId/logs

Get run-scoped logs with cursor-based pagination.

**Path Parameters:**
- `runId` - The run ID

**Query Parameters:**
- `limit` (optional, default: 100) - Number of log entries per page
- `cursor` (optional) - Timestamp cursor from previous response
- `level` (optional) - Filter by log level: `info`, `warn`, `error`, `debug`

**Response:**
```json
{
  "logs": [
    {
      "runId": "run-1704067200000-abc123",
      "timestamp": "2024-01-01T00:00:01Z",
      "level": "info",
      "message": "Backtest queued",
      "data": null
    },
    {
      "runId": "run-1704067200000-abc123",
      "timestamp": "2024-01-01T00:00:02Z",
      "level": "info",
      "message": "Simulation started",
      "data": { "callsFound": 100 }
    }
  ],
  "nextCursor": "2024-01-01T00:00:01Z" // or null
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Run not found
- `500 Internal Server Error` - Server error

**Notes:**
- Logs ordered by `timestamp` ASC (oldest first)
- Use `nextCursor` (timestamp) for pagination
- Logs stored in ClickHouse `run_logs` table

---

### GET /runs/:runId/artifacts

Get artifact metadata for a run.

**Path Parameters:**
- `runId` - The run ID

**Response:**
```json
{
  "artifacts": [
    {
      "type": "parquet",
      "path": "/artifacts/run-1704067200000-abc123/events.parquet",
      "size": 1048576,
      "createdAt": "2024-01-01T00:02:00Z"
    },
    {
      "type": "csv",
      "path": "/artifacts/run-1704067200000-abc123/summary.csv",
      "size": 2048,
      "createdAt": "2024-01-01T00:02:01Z"
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Run not found
- `500 Internal Server Error` - Server error

**Notes:**
- Artifacts scanned from file system (`ARTIFACTS_DIR` environment variable)
- Supported types: `parquet`, `csv`, `json`, `ndjson`, `log`
- Returns empty array if no artifacts found

---

### GET /runs/:runId/metrics

Get time-series metrics for a run.

**Path Parameters:**
- `runId` - The run ID

**Response:**
```json
{
  "drawdown": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "value": 0.0
    },
    {
      "timestamp": "2024-01-01T00:01:00Z",
      "value": -10.5
    }
  ],
  "exposure": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "value": 0.0
    },
    {
      "timestamp": "2024-01-01T00:01:00Z",
      "value": 1000.0
    }
  ],
  "fills": [
    {
      "timestamp": "2024-01-01T00:01:00Z",
      "type": "entry",
      "price": 0.001,
      "size": 1000.0,
      "pnl": null
    },
    {
      "timestamp": "2024-01-01T00:02:00Z",
      "type": "exit",
      "price": 0.0011,
      "size": 1000.0,
      "pnl": 100.0
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Run not found
- `500 Internal Server Error` - Server error

**Notes:**
- Metrics queried from ClickHouse `simulation_events` table
- Returns empty arrays if table doesn't exist or no data found
- `drawdown` - Cumulative PnL over time
- `exposure` - Position size over time
- `fills` - Trade events (entry/exit with prices and PnL)

---

## Leaderboard Endpoints

### GET /leaderboard

Get ranked leaderboard entries.

**Query Parameters:**
- `metric` (optional, default: `pnl`) - Sort metric: `pnl`, `stability`, `pareto`
- `timeframe` (optional) - Filter by timeframe
- `strategyId` (optional) - Filter by strategy ID
- `window` (optional) - Time window for ranking
- `limit` (optional, default: 50) - Number of results

**Response:**
```json
{
  "entries": [
    {
      "runId": "run-1704067200000-abc123",
      "strategyId": "momentum-v1",
      "totalPnl": 1000.5,
      "stability": 0.85,
      "trades": 10,
      "winRate": 0.6,
      "sharpeRatio": 1.5,
      "maxDrawdown": -50.2
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid query parameters
- `500 Internal Server Error` - Server error

---

### GET /leaderboard/strategies

Get strategy-level aggregated leaderboard.

**Query Parameters:** Same as `GET /leaderboard`

**Response:**
```json
{
  "entries": [
    {
      "strategyId": "momentum-v1",
      "avgPnl": 1000.5,
      "avgStability": 0.85,
      "totalRuns": 10,
      "winRate": 0.6
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

---

## Strategy Endpoints

### GET /strategies

List all available strategies.

**Response:**
```json
{
  "strategies": [
    {
      "id": "momentum-v1",
      "name": "momentum",
      "version": "1.0.0",
      "category": "momentum",
      "status": "active",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

---

### GET /strategies/:id

Get strategy details.

**Path Parameters:**
- `id` - Strategy ID (e.g., `momentum-v1`)

**Query Parameters:**
- `version` (optional) - Specific version to retrieve

**Response:**
```json
{
  "id": "momentum-v1",
  "name": "momentum",
  "version": "1.0.0",
  "category": "momentum",
  "status": "active",
  "config": {
    /* Strategy configuration */
  },
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Status Codes:**
- `200 OK` - Success
- `404 Not Found` - Strategy not found
- `500 Internal Server Error` - Server error

---

### POST /strategies

Create a new strategy version.

**Request Body:**
```json
{
  "name": "momentum",
  "version": "1.0.1",
  "category": "momentum",
  "config": {
    /* Strategy configuration */
  }
}
```

**Response:**
```json
{
  "id": "momentum-v1",
  "name": "momentum",
  "version": "1.0.1",
  "status": "active"
}
```

**Status Codes:**
- `201 Created` - Strategy created
- `400 Bad Request` - Invalid request body
- `500 Internal Server Error` - Server error

**Note:** Currently a stub endpoint.

---

### PATCH /strategies/:id

Update strategy metadata.

**Path Parameters:**
- `id` - Strategy ID

**Request Body:**
```json
{
  "status": "deprecated",
  "category": "legacy"
}
```

**Response:**
```json
{
  "id": "momentum-v1",
  "status": "deprecated",
  "category": "legacy"
}
```

**Status Codes:**
- `200 OK` - Strategy updated
- `404 Not Found` - Strategy not found
- `400 Bad Request` - Invalid request body
- `500 Internal Server Error` - Server error

**Note:** Currently a stub endpoint.

---

### POST /strategies/:id/validate

Validate strategy configuration.

**Path Parameters:**
- `id` - Strategy ID

**Request Body:**
```json
{
  "config": {
    /* Strategy configuration to validate */
  }
}
```

**Response:**
```json
{
  "valid": true,
  "errors": []
}
```

**Status Codes:**
- `200 OK` - Validation result
- `400 Bad Request` - Invalid request body
- `500 Internal Server Error` - Server error

**Note:** Currently a stub endpoint.

---

## Statistics Endpoints

### GET /statistics/overview

Get overview statistics.

**Response:**
```json
{
  "totalRuns": 1000,
  "uniqueStrategies": 10,
  "uniqueTokens": 50,
  "avgPnl": 500.25,
  "avgWinRate": 0.55
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

**Notes:**
- Aggregates from DuckDB `simulation_runs` table
- Returns zeros if table doesn't exist

---

### GET /statistics/pnl

Get PnL statistics with grouping.

**Query Parameters:**
- `groupBy` (optional) - Group by: `day`, `week`, `month`, `strategy`, `token`, `caller`

**Response:**
```json
{
  "groups": [
    {
      "period": "2024-01-01",
      "totalPnl": 1000.5,
      "avgPnl": 500.25,
      "runs": 2
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid `groupBy` parameter
- `500 Internal Server Error` - Server error

---

### GET /statistics/distribution

Get distribution histograms.

**Response:**
```json
{
  "pnl": [
    {
      "bucket": "-1000 to -500",
      "count": 10
    },
    {
      "bucket": "-500 to 0",
      "count": 20
    },
    {
      "bucket": "0 to 500",
      "count": 30
    }
  ],
  "trades": [
    {
      "bucket": "0 to 10",
      "count": 50
    },
    {
      "bucket": "10 to 20",
      "count": 30
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

---

### GET /statistics/correlation

Get correlation statistics.

**Response:**
```json
{
  "correlations": [
    {
      "metric1": "totalPnl",
      "metric2": "trades",
      "correlation": 0.75
    },
    {
      "metric1": "totalPnl",
      "metric2": "winRate",
      "correlation": 0.60
    }
  ]
}
```

**Status Codes:**
- `200 OK` - Success
- `500 Internal Server Error` - Server error

**Notes:**
- Uses DuckDB `CORR()` function
- Correlates PnL, trades, and win rate

---

## Legacy Endpoints (Backward Compatibility)

These endpoints redirect to the new resource-based endpoints:

- `GET /api/leaderboard` → `GET /leaderboard`
- `GET /api/strategies` → `GET /strategies`
- `GET /api/simulation-runs` → `GET /runs`
- `GET /api/health` → Health check endpoint

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {
    /* Additional error details */
  }
}
```

**Common Status Codes:**
- `400 Bad Request` - Invalid request parameters or body
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error

---

## Pagination

List endpoints use cursor-based pagination:

1. First request: Don't include `cursor` parameter
2. Response includes `nextCursor` if more results available
3. Subsequent requests: Include `cursor` parameter with value from `nextCursor`
4. When `nextCursor` is `null`, no more results available

**Example:**
```bash
# First page
GET /runs?limit=50

# Response includes nextCursor
{
  "runs": [...],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTAxVDAwOjAwOjAwWiJ9"
}

# Next page
GET /runs?limit=50&cursor=eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTAxVDAwOjAwOjAwWiJ9
```

---

## Environment Variables

- `PORT` - Server port (default: `3001`)
- `DUCKDB_PATH` - Path to DuckDB database (default: `data/tele.duckdb`)
- `ARTIFACTS_DIR` - Base directory for artifacts (default: `./artifacts`)
- `CLICKHOUSE_DATABASE` - ClickHouse database name (default: `quantbot`)

---

## Data Models

### Run Status

```typescript
{
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  strategyId?: string;
  strategyVersion?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  config?: unknown;
  summary?: {
    callsFound?: number;
    callsSucceeded?: number;
    callsFailed?: number;
    trades?: number;
    totalPnl?: number;
    maxDrawdown?: number;
    sharpeRatio?: number;
    winRate?: number;
  };
  error?: string;
}
```

### Run Log

```typescript
{
  runId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: unknown;
}
```

### Artifact

```typescript
{
  type: 'parquet' | 'csv' | 'json' | 'ndjson' | 'log';
  path: string;
  size: number;
  createdAt?: string;
}
```

---

## Examples

### Starting a Backtest

```bash
curl -X POST http://localhost:3001/backtest \
  -H "Content-Type: application/json" \
  -d '{
    "strategyId": "momentum-v1",
    "universe": {
      "type": "tokens",
      "mints": ["7pXs123456789012345678901234567890pump"]
    },
    "timeframe": {
      "from": "2024-01-01T00:00:00Z",
      "to": "2024-01-31T23:59:59Z"
    }
  }'
```

### Checking Run Status

```bash
curl http://localhost:3001/runs/run-1704067200000-abc123
```

### Getting Run Logs

```bash
curl "http://localhost:3001/runs/run-1704067200000-abc123/logs?limit=10&level=error"
```

### Getting Leaderboard

```bash
curl "http://localhost:3001/leaderboard?metric=pnl&limit=10"
```

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- Cursor values are base64url-encoded
- Pagination cursors are opaque - don't parse or modify them
- Run IDs are generated server-side and are unique
- Logs are stored in ClickHouse for time-series optimization
- Run status is stored in DuckDB for fast queries
- Artifacts are scanned from the file system

