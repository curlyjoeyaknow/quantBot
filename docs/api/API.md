# QuantBot API Documentation

> REST API for QuantBot analytics and simulation engine

**Base URL**: `http://localhost:3000` (default)

**API Version**: v1

**OpenAPI Documentation**: Available at `/docs` (Swagger UI) when `NODE_ENV !== 'production'`

---

## Table of Contents

- [Authentication](#authentication)
- [Health Checks](#health-checks)
- [OHLCV Endpoints](#ohlcv-endpoints)
- [Simulation Endpoints](#simulation-endpoints)
- [Metrics Endpoint](#metrics-endpoint)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Examples](#examples)

---

## Authentication

Currently, the API does not require authentication. In production, authentication should be added via API keys or OAuth2.

**Future**: API key authentication will be required for all endpoints except health checks.

---

## Health Checks

### `GET /health`

Comprehensive health check endpoint that returns the status of all system components.

**Response Codes**:
- `200 OK` - System is healthy or degraded
- `503 Service Unavailable` - System is unhealthy

**Response Body**:
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2025-01-23T12:00:00.000Z",
  "checks": {
    "clickhouse": {
      "status": "ok" | "error" | "warning",
      "message": "Connection successful"
    },
    "birdeye": {
      "status": "ok" | "error" | "warning",
      "message": "API quota: 80% remaining"
    },
    "helius": {
      "status": "ok" | "error" | "warning",
      "message": "API quota: 90% remaining"
    }
  }
}
```

**Example**:
```bash
curl http://localhost:3000/health
```

---

### `GET /health/ready`

Readiness probe for Kubernetes/Docker orchestration. Returns whether the service is ready to accept traffic.

**Response Codes**:
- `200 OK` - Service is ready
- `503 Service Unavailable` - Service is not ready

**Response Body**:
```json
{
  "ready": true,
  "timestamp": "2025-01-23T12:00:00.000Z"
}
```

**Example**:
```bash
curl http://localhost:3000/health/ready
```

---

### `GET /health/live`

Liveness probe for Kubernetes/Docker orchestration. Returns whether the service process is alive.

**Response Codes**:
- `200 OK` - Service is alive

**Response Body**:
```json
{
  "alive": true,
  "timestamp": "2025-01-23T12:00:00.000Z"
}
```

**Example**:
```bash
curl http://localhost:3000/health/live
```

---

## OHLCV Endpoints

### `GET /api/v1/ohlcv/stats`

Get aggregated statistics about OHLCV (Open/High/Low/Close/Volume) data stored in the system.

**Query Parameters**:
- `chain` (optional, string) - Filter by blockchain: `solana`, `ethereum`, `bsc`, `base`
- `interval` (optional, string) - Filter by candle interval: `1m`, `5m`, `15m`, `1h`, `4h`, `1d`
- `mint` (optional, string) - Filter by specific token mint address

**Response Codes**:
- `200 OK` - Statistics retrieved successfully
- `500 Internal Server Error` - Failed to fetch statistics

**Response Body**:
```json
{
  "timestamp": "2025-01-23T12:00:00.000Z",
  "chain": "solana",
  "interval": "5m",
  "mint": "So11111111111111111111111111111111111111112",
  "totalCandles": 125000,
  "uniqueTokens": 1500,
  "dateRange": {
    "earliest": "2024-01-01T00:00:00.000Z",
    "latest": "2025-01-23T12:00:00.000Z"
  },
  "intervals": [
    {
      "interval": "1m",
      "candleCount": 50000,
      "tokenCount": 1200
    },
    {
      "interval": "5m",
      "candleCount": 75000,
      "tokenCount": 1500
    }
  ],
  "chains": [
    {
      "chain": "solana",
      "candleCount": 125000,
      "tokenCount": 1500
    }
  ],
  "topTokens": [
    {
      "token_address": "So11111111111111111111111111111111111111112",
      "chain": "solana",
      "candleCount": 5000,
      "firstSeen": "2024-01-01T00:00:00.000Z",
      "lastSeen": "2025-01-23T12:00:00.000Z"
    }
  ]
}
```

**Example**:
```bash
# Get all OHLCV statistics
curl http://localhost:3000/api/v1/ohlcv/stats

# Filter by chain
curl "http://localhost:3000/api/v1/ohlcv/stats?chain=solana"

# Filter by interval
curl "http://localhost:3000/api/v1/ohlcv/stats?interval=5m"

# Filter by specific token
curl "http://localhost:3000/api/v1/ohlcv/stats?mint=So11111111111111111111111111111111111111112"
```

---

## Simulation Endpoints

### `POST /api/v1/simulation/runs`

Create a new simulation run to test a trading strategy over historical data.

**Request Body**:
```json
{
  "strategyName": "ichimoku_cross",
  "callerName": "pump_fun_alerts",
  "from": "2024-01-01T00:00:00.000Z",
  "to": "2024-12-31T23:59:59.999Z",
  "options": {
    "dryRun": false,
    "preWindowMinutes": 260,
    "postWindowMinutes": 1440
  }
}
```

**Request Body Schema**:
- `strategyName` (required, string) - Name of the strategy to run
- `callerName` (optional, string) - Filter by specific caller/signal source
- `from` (required, ISO 8601 datetime) - Start date for simulation
- `to` (required, ISO 8601 datetime) - End date for simulation
- `options` (optional, object):
  - `dryRun` (optional, boolean) - If true, don't persist results
  - `preWindowMinutes` (optional, number) - Minutes before alert to fetch data
  - `postWindowMinutes` (optional, number) - Minutes after alert to simulate

**Response Codes**:
- `201 Created` - Simulation run created successfully
- `400 Bad Request` - Invalid request body
- `500 Internal Server Error` - Failed to run simulation

**Response Body**:
```json
{
  "runId": "run-abc123",
  "strategyName": "ichimoku_cross",
  "callerName": "pump_fun_alerts",
  "from": "2024-01-01T00:00:00.000Z",
  "to": "2024-12-31T23:59:59.999Z",
  "totalCalls": 1500,
  "successfulCalls": 1450,
  "failedCalls": 50,
  "totalTrades": 3200,
  "pnlStats": {
    "min": -0.15,
    "max": 2.45,
    "mean": 0.12,
    "median": 0.08
  },
  "results": [
    {
      "callId": "call-123",
      "mint": "So11111111111111111111111111111111111111112",
      "chain": "solana",
      "alertTimestamp": "2024-06-15T10:30:00.000Z",
      "finalPnl": 0.15,
      "totalTrades": 5,
      "errorMessage": null
    }
  ]
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/api/v1/simulation/runs \
  -H "Content-Type: application/json" \
  -d '{
    "strategyName": "ichimoku_cross",
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-12-31T23:59:59.999Z"
  }'
```

---

### `GET /api/v1/simulation/runs`

List simulation runs with optional filtering.

**Query Parameters**:
- `strategyName` (optional, string) - Filter by strategy name
- `callerName` (optional, string) - Filter by caller name
- `from` (optional, ISO 8601 datetime) - Filter runs starting from this date
- `to` (optional, ISO 8601 datetime) - Filter runs ending before this date
- `limit` (optional, number, default: 50, max: 100) - Maximum number of runs to return
- `offset` (optional, number, default: 0) - Number of runs to skip

**Response Codes**:
- `200 OK` - Runs retrieved successfully

**Response Body**:
```json
{
  "runs": [
    {
      "runId": "run-abc123",
      "strategyName": "ichimoku_cross",
      "callerName": "pump_fun_alerts",
      "from": "2024-01-01T00:00:00.000Z",
      "to": "2024-12-31T23:59:59.999Z",
      "totals": {
        "calls": 1500,
        "successful": 1450,
        "failed": 50,
        "trades": 3200
      },
      "pnl": {
        "min": -0.15,
        "max": 2.45,
        "mean": 0.12,
        "median": 0.08
      }
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

**Example**:
```bash
# List all runs
curl http://localhost:3000/api/v1/simulation/runs

# Filter by strategy
curl "http://localhost:3000/api/v1/simulation/runs?strategyName=ichimoku_cross"

# Paginate results
curl "http://localhost:3000/api/v1/simulation/runs?limit=10&offset=20"
```

**Note**: This endpoint currently returns an empty list. Full implementation is pending.

---

### `GET /api/v1/simulation/runs/:runId`

Get detailed information about a specific simulation run.

**Path Parameters**:
- `runId` (required, string) - The unique identifier of the simulation run

**Response Codes**:
- `200 OK` - Run details retrieved successfully
- `404 Not Found` - Run not found
- `500 Internal Server Error` - Failed to retrieve run

**Response Body**:
```json
{
  "runId": "run-abc123",
  "strategyName": "ichimoku_cross",
  "callerName": "pump_fun_alerts",
  "from": "2024-01-01T00:00:00.000Z",
  "to": "2024-12-31T23:59:59.999Z",
  "results": [
    {
      "callId": "call-123",
      "mint": "So11111111111111111111111111111111111111112",
      "chain": "solana",
      "alertTimestamp": "2024-06-15T10:30:00.000Z",
      "finalPnl": 0.15,
      "totalTrades": 5,
      "errorMessage": null
    }
  ],
  "totals": {
    "calls": 1500,
    "successful": 1450,
    "failed": 50,
    "trades": 3200
  },
  "pnl": {
    "min": -0.15,
    "max": 2.45,
    "mean": 0.12,
    "median": 0.08
  }
}
```

**Example**:
```bash
curl http://localhost:3000/api/v1/simulation/runs/run-abc123
```

**Note**: This endpoint currently returns 404. Full implementation is pending.

---

## Metrics Endpoint

### `GET /metrics`

Prometheus metrics endpoint for monitoring and alerting.

**Response Codes**:
- `200 OK` - Metrics retrieved successfully

**Response Body**: Plain text in Prometheus format

**Example**:
```bash
curl http://localhost:3000/metrics
```

**Example Response**:
```
# HELP quantbot_api_requests_total Total number of API requests
# TYPE quantbot_api_requests_total counter
quantbot_api_requests_total{method="GET",path="/health",status="200"} 150

# HELP quantbot_api_request_duration_seconds Request duration in seconds
# TYPE quantbot_api_request_duration_seconds histogram
quantbot_api_request_duration_seconds_bucket{method="GET",path="/health",le="0.1"} 145
quantbot_api_request_duration_seconds_bucket{method="GET",path="/health",le="0.5"} 150

# HELP quantbot_circuit_breaker_tripped Circuit breaker tripped status
# TYPE quantbot_circuit_breaker_tripped gauge
quantbot_circuit_breaker_tripped{api_name="birdeye"} 0
quantbot_circuit_breaker_tripped{api_name="helius"} 0
```

---

## Error Handling

All endpoints return errors in a consistent format:

**Error Response**:
```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "ERROR_CODE",
    "details": {
      "field": "Additional error details"
    }
  }
}
```

**Common HTTP Status Codes**:
- `200 OK` - Request successful
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request (validation errors)
- `404 Not Found` - Resource not found
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service unavailable (health check failures)

**Example Error Response**:
```json
{
  "error": {
    "message": "Invalid date range: 'to' must be after 'from'",
    "code": "VALIDATION_ERROR",
    "details": {
      "from": "2024-12-31T23:59:59.999Z",
      "to": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

---

## Rate Limiting

Currently, the API does not enforce rate limiting. In production, rate limiting should be added to prevent abuse.

**Future**: Rate limiting will be implemented with:
- 100 requests per minute per IP (default)
- 1000 requests per hour per IP (default)
- Configurable limits per endpoint

---

## Examples

### Complete Simulation Workflow

```bash
# 1. Check health
curl http://localhost:3000/health

# 2. Create a simulation run
RUN_ID=$(curl -X POST http://localhost:3000/api/v1/simulation/runs \
  -H "Content-Type: application/json" \
  -d '{
    "strategyName": "ichimoku_cross",
    "from": "2024-01-01T00:00:00.000Z",
    "to": "2024-12-31T23:59:59.999Z"
  }' | jq -r '.runId')

# 3. Get run details
curl "http://localhost:3000/api/v1/simulation/runs/$RUN_ID"

# 4. List all runs
curl http://localhost:3000/api/v1/simulation/runs
```

### Monitoring Integration

```bash
# Prometheus scrape config
scrape_configs:
  - job_name: 'quantbot-api'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['localhost:3000']
```

### Health Check Integration (Kubernetes)

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

---

## OpenAPI/Swagger Documentation

When running in non-production mode (`NODE_ENV !== 'production'`), interactive API documentation is available at:

```
http://localhost:3000/docs
```

The Swagger UI provides:
- Interactive API explorer
- Request/response schemas
- Try-it-out functionality
- Example requests and responses

---

## Client Libraries

Currently, no official client libraries are provided. The API follows standard REST conventions and can be used with any HTTP client.

**Recommended Clients**:
- **JavaScript/TypeScript**: `fetch`, `axios`, `node-fetch`
- **Python**: `requests`, `httpx`
- **cURL**: Command-line tool
- **Postman**: API testing tool

---

## Changelog

### v1.0.0 (2025-01-23)
- Initial API release
- Health check endpoints
- OHLCV statistics endpoint
- Simulation run management endpoints
- Prometheus metrics endpoint
- OpenAPI/Swagger documentation

---

## Support

For issues, questions, or contributions, see:
- [Contributing Guide](../CONTRIBUTING.md)
- [Architecture Documentation](./ARCHITECTURE.md)
- [GitHub Issues](https://github.com/your-org/quantbot/issues)

