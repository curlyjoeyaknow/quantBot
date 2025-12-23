# @quantbot/api

REST API for QuantBot using Fastify.

## Features

- **Health Checks** - `/health`, `/health/ready`, `/health/live`
- **OHLCV Statistics** - `/api/v1/ohlcv/stats`
- **Simulation Runs** - Create and list simulation runs
- **OpenAPI Documentation** - Auto-generated Swagger UI at `/docs`

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm --filter @quantbot/api build

# Start server
pnpm --filter @quantbot/api start

# Development mode (with hot reload)
pnpm --filter @quantbot/api dev
```

## Configuration

Environment variables:

- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `NODE_ENV` - Environment (production disables Swagger)

## API Endpoints

### Health Checks

- `GET /health` - Health check with system status
- `GET /health/ready` - Readiness probe
- `GET /health/live` - Liveness probe

### OHLCV

- `GET /api/v1/ohlcv/stats` - Get OHLCV statistics
  - Query params: `chain`, `interval`, `minCoverage`

### Simulation

- `POST /api/v1/simulation/runs` - Create simulation run
- `GET /api/v1/simulation/runs` - List simulation runs
- `GET /api/v1/simulation/runs/:runId` - Get simulation run details

## OpenAPI Documentation

When `NODE_ENV !== 'production'`, Swagger UI is available at:

```
http://localhost:3000/docs
```

## Architecture

The API package follows the same architecture patterns:

- **Routes** - Thin adapters that parse requests and call workflows
- **Workflows** - Business logic orchestration
- **JSON-serializable responses** - All responses are JSON-safe

## Example Usage

```typescript
import { createApiServer } from '@quantbot/api';

const server = await createApiServer({
  port: 3000,
  enableSwagger: true,
});

await server.start();
```

