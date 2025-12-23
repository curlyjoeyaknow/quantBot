# @quantbot/web

Next.js-based analytics dashboard for QuantBot.

## Overview

This package provides a web interface for:
- **Caller Performance**: Win rates, ATH multiples, time-to-ATH metrics
- **Simulation Results**: Strategy backtest results, PnL charts, trade events
- **Analytics Overview**: System metrics, ATH distributions, recent calls

## Status

✅ **Implemented** - All core features are complete:
- All pages and components implemented
- API routes functional
- Health check endpoint available
- Basic tests added

⚠️ **In Progress**:
- Component tests (requires Next.js test setup)
- Production deployment
- Monitoring integration

## Development

```bash
# Start development server
pnpm --filter @quantbot/web dev

# Build for production
pnpm --filter @quantbot/web build

# Start production server
pnpm --filter @quantbot/web start

# Run tests
pnpm --filter @quantbot/web test

# Run tests with coverage
pnpm --filter @quantbot/web test:coverage
```

## Entry Point

- **Development**: `http://localhost:3000` (default Next.js port)
- **Health Check**: `http://localhost:3000/api/health`
- **Main Dashboard**: `http://localhost:3000/`

## Environment Variables

- `NEXT_PUBLIC_API_URL` - API server URL (default: http://localhost:3000)
- `NODE_ENV` - Environment mode

## Architecture

The dashboard follows the ports/adapters architecture:
- **API Routes**: Thin adapters that call existing services
- **Server Components**: Fetch data server-side
- **Client Components**: Interactive charts and tables
- **No Business Logic**: All logic stays in existing packages

## Routes

- `/` - Dashboard overview
- `/callers` - Caller performance metrics
- `/simulations` - Simulation results visualization
- `/analytics` - Analytics deep dive

## API Endpoints

- `GET /api/health` - Health check endpoint
- `GET /api/analytics` - Dashboard summary
- `GET /api/analytics/callers` - Caller metrics
- `GET /api/analytics/calls` - Call performance data
- `GET /api/analytics/ath-distribution` - ATH distribution buckets
- `GET /api/simulations/runs` - List simulation runs
- `GET /api/simulations/runs/[runId]` - Get run details
- `GET /api/simulations/runs/[runId]/results` - Get run results
- `GET /api/simulations/runs/[runId]/events` - Get run events

## Testing

Tests are located in `tests/unit/`:
- API route tests (`tests/unit/api/`)
- Component tests (placeholder, requires Next.js test setup)

Run tests:
```bash
pnpm --filter @quantbot/web test
```

## Monitoring

Health check endpoint available at `/api/health`:
- Returns status: `healthy`, `degraded`, or `unhealthy`
- Checks: API availability, analytics engine availability
- Includes response time and version information

## Known Issues

- Turbopack/webpack config warning (non-blocking)
- Component tests require additional Next.js test setup
- Production deployment not yet configured
