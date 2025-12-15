# QuantBot API Documentation

## Overview

The QuantBot API is a RESTful API built with Fastify that provides endpoints for:

- OHLCV candle data queries
- Token metadata and management
- Call history tracking
- Simulation run management
- Data ingestion

## Accessing the API Documentation

### Interactive Swagger UI

Once the API server is running, access the interactive API documentation at:

```
http://localhost:3000/api/docs
```

The Swagger UI provides:

- Complete endpoint documentation
- Request/response schemas
- Try-it-out functionality
- Example requests and responses

### OpenAPI JSON Schema

The OpenAPI JSON schema is available at:

```
http://localhost:3000/api/docs/json
```

This can be imported into:

- Postman
- Insomnia
- Other API testing tools
- Code generators

## Starting the API Server

```bash
# From the root directory
cd packages/api
pnpm dev

# Or from root
pnpm --filter @quantbot/api dev
```

The server will start on `http://localhost:3000` by default (configurable via `API_PORT` environment variable).

## API Endpoints

### Health Checks

- `GET /api/v1/health` - Basic health check
- `GET /api/v1/health/detailed` - Detailed health with metrics
- `GET /api/v1/health/ready` - Readiness check (Kubernetes)
- `GET /api/v1/health/live` - Liveness check (Kubernetes)

### OHLCV Data

- `GET /api/v1/ohlcv/candles` - Fetch OHLCV candles for a token
- `GET /api/v1/ohlcv/candles/multi-interval` - Fetch candles for multiple intervals

**Example Request:**

```bash
curl "http://localhost:3000/api/v1/ohlcv/candles?tokenAddress=7pXs123456789012345678901234567890pump&chain=solana&startTime=2024-01-01T00:00:00Z&endTime=2024-01-02T00:00:00Z&interval=5m"
```

### Tokens

- `GET /api/v1/tokens/:chain/:address` - Get token by chain and address
- `GET /api/v1/tokens` - List tokens (planned)

### Calls

- `GET /api/v1/calls/:id` - Get call by ID
- `GET /api/v1/calls` - List calls with filters
- `GET /api/v1/calls/callers` - List all callers

### Simulations

- `GET /api/v1/simulations/runs/:id` - Get simulation run by ID
- `GET /api/v1/simulations/runs` - List simulation runs with filters
- `GET /api/v1/simulations/results/:runId` - Get simulation results (planned)

### Ingestion

- `POST /api/v1/ingestion/candles` - Trigger OHLCV candle ingestion
- `POST /api/v1/ingestion/candles/batch` - Batch ingest candles for multiple tokens

**Example Request:**

```bash
curl -X POST "http://localhost:3000/api/v1/ingestion/candles" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenAddress": "7pXs123456789012345678901234567890pump",
    "chain": "solana",
    "alertTime": "2024-01-01T10:30:00Z",
    "options": {
      "useCache": true,
      "forceRefresh": false
    }
  }'
```

## Authentication

Currently, the API uses API key authentication via the `x-api-key` header (configurable via `API_KEY` environment variable).

**Example:**

```bash
curl -H "x-api-key: your-api-key" \
  "http://localhost:3000/api/v1/health"
```

## Rate Limiting

The API implements rate limiting:

- **Default**: 100 requests per minute per IP
- Configurable via `@fastify/rate-limit` settings

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error message",
  "details": [] // Optional, for validation errors
}
```

**HTTP Status Codes:**

- `200` - Success
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid API key)
- `404` - Not Found
- `500` - Internal Server Error
- `501` - Not Implemented
- `503` - Service Unavailable (readiness check failed)

## Request/Response Formats

### Date/Time Format

All date/time values use ISO 8601 format:

- Example: `2024-01-01T10:30:00Z`
- Timezone: UTC (Z suffix)

### Token Addresses

Token addresses (mint addresses) must be:

- Full, unmodified addresses (32-44 characters)
- Case-sensitive
- Base58-encoded (Solana)

**Important**: Never truncate or modify token addresses before sending to the API.

### Candle Intervals

Supported intervals:

- `1m` - 1 minute
- `5m` - 5 minutes
- `15m` - 15 minutes
- `1h` - 1 hour
- `4h` - 4 hours
- `1d` - 1 day

## Pagination

List endpoints support pagination via query parameters:

- `limit` - Maximum number of results (default: varies by endpoint)
- `offset` - Offset for pagination (default: 0)

**Example:**

```
GET /api/v1/calls?limit=50&offset=100
```

## Caching

The API uses StorageEngine which includes:

- In-memory LRU cache for OHLCV data
- Database caching (ClickHouse)
- Automatic cache invalidation

Cache behavior can be controlled via:

- `useCache` parameter (ingestion endpoints)
- `forceRefresh` parameter (ingestion endpoints)

## Development

### Local Development

```bash
# Start API server in development mode
cd packages/api
pnpm dev

# Server will reload on file changes
```

### Testing

```bash
# Run API tests
cd packages/api
pnpm test

# Run with coverage
pnpm test:coverage
```

### Building

```bash
# Build API package
cd packages/api
pnpm build

# Output: packages/api/dist/
```

## Integration Examples

### TypeScript/JavaScript

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3000/api/v1',
  headers: {
    'x-api-key': process.env.API_KEY,
  },
});

// Fetch candles
const response = await api.get('/ohlcv/candles', {
  params: {
    tokenAddress: '7pXs123456789012345678901234567890pump',
    chain: 'solana',
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-01-02T00:00:00Z',
    interval: '5m',
  },
});

console.log(response.data.candles);
```

### Python

```python
import requests

API_BASE = "http://localhost:3000/api/v1"
API_KEY = "your-api-key"

headers = {"x-api-key": API_KEY}

# Fetch candles
response = requests.get(
    f"{API_BASE}/ohlcv/candles",
    params={
        "tokenAddress": "7pXs123456789012345678901234567890pump",
        "chain": "solana",
        "startTime": "2024-01-01T00:00:00Z",
        "endTime": "2024-01-02T00:00:00Z",
        "interval": "5m",
    },
    headers=headers,
)

candles = response.json()["candles"]
```

## Environment Variables

```env
# API Configuration
API_PORT=3000
API_HOST=0.0.0.0
API_URL=http://localhost:3000
API_KEY=your-api-key-here

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:3001

# Logging
LOG_LEVEL=info
```

## Troubleshooting

### API Server Won't Start

1. Check if port 3000 is available
2. Verify database connections (PostgreSQL, ClickHouse)
3. Check environment variables
4. Review logs: `logs/combined-*.log`

### 401 Unauthorized

- Verify `API_KEY` environment variable is set
- Check that `x-api-key` header is included in requests
- Ensure API key matches the configured value

### 503 Service Unavailable

- Check database connectivity
- Verify StorageEngine is initialized
- Review readiness check endpoint: `/api/v1/health/ready`

### Rate Limit Errors

- Reduce request frequency
- Implement exponential backoff
- Contact administrator for rate limit adjustments

## Additional Resources

- [Architecture Documentation](../ARCHITECTURE.md)
- [StorageEngine Documentation](../STORAGE_ENGINE.md)
- [OHLCV Ingestion Engine](../OHLCV_INGESTION_ENGINE.md)
