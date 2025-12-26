# @quantbot/lab

Research Lab Package - Feature computation, strategy compilation, simulation, and optimization.

## Features

- **Feature Computation** - Indicator registry, feature set compilation, caching
- **Strategy Compilation** - Graph-based strategy compilation and condition evaluation
- **Simulation Kernel** - Pure compute simulation engine
- **Risk Engine** - Risk management and circuit breakers
- **Optimization** - Grid search, random search, parameter space exploration
- **Metrics** - Stability scoring and performance metrics
- **Rolling Windows** - Time-windowed execution

## Self-Contained Web UI

The lab package includes a simple Fastify-based web UI that doesn't depend on the Next.js web package.

### Running the Server

```bash
# Build the package first
pnpm --filter @quantbot/lab build

# Run the server (production)
pnpm --filter @quantbot/lab server

# Or in development mode (with auto-reload)
pnpm --filter @quantbot/lab dev

# Or set a custom port
PORT=3002 pnpm --filter @quantbot/lab server
```

The server will start on `http://localhost:3001` (or the port specified in `PORT` environment variable).

Open your browser to `http://localhost:3001` to view the lab dashboard.

### API Endpoints

- `GET /` - Web UI (HTML dashboard)
- `GET /api/leaderboard?sort=pnl&limit=50` - Get leaderboard entries
- `GET /api/health` - Health check

### Leaderboard Sorting

- `sort=pnl` - Sort by profit and loss (default)
- `sort=stability` - Sort by stability score
- `sort=pareto` - Sort by Pareto frontier

## Architecture

The lab package is self-contained and doesn't depend on the web package. It provides:

1. **Core Lab Logic** - All research lab functionality
2. **Simple Web UI** - Fastify server with basic HTML/CSS/JS
3. **Direct Storage Access** - Uses `@quantbot/storage` directly

This keeps the lab package independent and allows it to be used standalone or integrated into other applications.

