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

```text
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

## Next Steps

### Phase 1: API Foundation

- [ ] Add authentication/authorization middleware
- [ ] Add rate limiting
- [ ] Add request validation with Zod schemas
- [ ] Add analytics endpoints
- [ ] Add slice export endpoints
- [ ] Add WebSocket support for real-time updates
- [ ] Add metrics/observability endpoints
- [ ] Production deployment configuration
- [ ] API versioning strategy

#### Backend/Simulation Package Integration

Integrate `@quantbot/backtest` and simulation workflows into API endpoints.

- [ ] **Backtest Endpoints** - Integrate `@quantbot/backtest` package:
  - `POST /api/v1/backtest/path-only` - Run path-only truth layer backtest
  - `POST /api/v1/backtest/policy` - Run policy backtest execution
  - `POST /api/v1/backtest/optimize` - Run policy optimization
  - `GET /api/v1/backtest/runs/:runId` - Get backtest run details
  - `GET /api/v1/backtest/runs/:runId/path-metrics` - Get path metrics for run
  - `GET /api/v1/backtest/runs/:runId/policy-results` - Get policy results for run
  - `GET /api/v1/backtest/truth-leaderboard/:runId` - Get truth leaderboard

- [ ] **Coverage & Planning** - Integrate backtest planning:
  - `POST /api/v1/backtest/coverage` - Calculate coverage for caller/timeframe
  - `POST /api/v1/backtest/plan` - Generate backtest plan (coverage + slice spec)

- [ ] **Policy Management** - Integrate policy execution:
  - `GET /api/v1/policies/:caller/best` - Get best policies for caller
  - `POST /api/v1/policies/evaluate` - Evaluate policy on specific calls
  - `GET /api/v1/policies/leaderboard` - Policy performance leaderboard

- [ ] **Optimization Endpoints** - Integrate optimizer:
  - `POST /api/v1/optimization/grid-search` - Run grid search optimization
  - `GET /api/v1/optimization/results/:runId` - Get optimization results
  - `POST /api/v1/optimization/validate` - Validate optimization config

- [ ] **Workflow Integration** - Wire workflows through API:
  - Integrate `runPathOnly` workflow via API route
  - Integrate `runPolicyBacktest` workflow via API route
  - Integrate `optimizeCallerPolicies` workflow via API route
  - Use `WorkflowContext` for dependency injection
  - Ensure routes are thin adapters calling workflows

- [ ] **Data Access** - Integrate data sources:
  - Use `CallsSourcePort` for caller/alert queries
  - Use `CandlesSourcePort` for candle data
  - Use `ResultsSinkPort` for storing results
  - Integrate DuckDB adapters for persistence

- [ ] **Async Execution** - Support long-running backtests:
  - Queue backtest jobs (use existing job system or simple queue)
  - Track run status (queued, running, completed, failed)
  - Provide status polling endpoint
  - WebSocket support for real-time status updates
  - Store run artifacts (path metrics, policy results) for retrieval

- [ ] **Error Handling & Validation**:
  - Validate backtest plans before execution
  - Return meaningful errors for invalid configs
  - Handle coverage failures gracefully
  - Provide dry-run endpoint for validation

- [ ] **Response Formatting**:
  - Format path metrics as JSON (caller-level and call-level)
  - Format policy results with realized metrics
  - Format optimization results with ranked policies
  - Include run metadata (runId, createdAt, status, config hash)

### Phase 1.5: Architecture Cleanup (Debt Reduction)

The following items are duplicated, deprecated, or redundant given the current architecture:

#### Critical: Code Duplication

- [ ] **`packages/backtest/src/sim/` is a full copy of `packages/simulation/src/`**
  - The `@quantbot/backtest` package copies the entire simulation engine under `src/sim/`
  - Both packages have nearly identical directory structures (core/, engine/, execution/, indicators/, etc.)
  - Only 4 files differ slightly: `index.ts`, `logger.ts`, `overlay-simulation.ts`, `sinks.ts`
  - **Action**: Delete `packages/backtest/src/sim/` and use `@quantbot/simulation` as dependency
  - **Impact**: `@quantbot/backtest` already declares `@quantbot/simulation` as a dependency (line 69 of package.json)

#### Deprecated Code (Already Marked)

- [ ] **`packages/workflows/src/research/run-manifest.ts`** - All functions deprecated
  - `fromCLIManifest()` - Use RunManifest from @quantbot/core directly
  - `fromRunArtifact()` - Use createRunManifest from @quantbot/core
  - `createCanonicalManifest()` - Use createRunManifest from @quantbot/core
  - **Action**: Remove file after confirming no imports remain

- [ ] **`packages/simulation/src/engine/StrategyEngine.ts`** - Deprecated legacy module
  - Uses legacy Call model (not CallSignal)
  - Should use `runOverlaySimulation()` instead
  - Duplicated in `packages/backtest/src/sim/engine/StrategyEngine.ts`
  - **Action**: Remove after verifying all usages migrated

- [ ] **`packages/storage/src/engine/StorageEngine.ts`** - 10+ deprecated PostgreSQL methods
  - Methods marked `@deprecated PostgreSQL removed. Use DuckDB repositories directly.`
  - `insertSimulation()`, `insertSimulationRun()`, `querySimulationRuns()`, etc.
  - `getStorageEngine()` singleton pattern deprecated
  - **Action**: Remove deprecated methods or entire class if no longer needed

- [ ] **`packages/ohlcv/src/candles.ts`** - Deprecated API-calling functions
  - `getHistoricalCandles()` deprecated - use @quantbot/api-clients
  - `batchFetchCandles()` deprecated - use @quantbot/jobs
  - **Action**: Remove or move to @quantbot/jobs layer

- [ ] **`packages/utils/src/types.ts`** - Deprecated type file
  - "This file is deprecated. Import types directly from @quantbot/core."
  - **Action**: Remove after verifying no imports

- [ ] **`packages/utils/src/utils/RepeatSimulationHelper.ts`** - Deprecated helper
  - "This helper is deprecated and kept only for test coverage."
  - SessionService interface deprecated (service no longer exists)
  - **Action**: Remove after updating tests

- [ ] **`packages/ingestion/src/types.ts`** - Deprecated Chain type
  - "Chain type is now exported from @quantbot/core."
  - **Action**: Remove after verifying all imports use @quantbot/core

#### Redundant Patterns

- [ ] **Multiple simulation entry points**:
  - `runSimulation()` in `packages/workflows/src/simulation/runSimulation.ts`
  - `runSimulationDuckdb()` in `packages/workflows/src/simulation/runSimulationDuckdb.ts`
  - `ResearchSimulationAdapter.run()` in `packages/workflows/src/research/simulation-adapter.ts`
  - `SimulationService.runSimulation()` in `packages/simulation/src/simulation-service.ts` (Python)
  - `SimulationKernel` in `packages/lab/src/simulation/SimulationKernel.ts`
  - **Action**: Consolidate to single canonical entry point per use case

- [ ] **Research OS services overlap with backtest package**:
  - `DataSnapshotService` creates snapshots, but backtest has slice/coverage system
  - `ExecutionRealityService` models execution, but backtest has execution-models system
  - **Action**: Evaluate if Research OS services should wrap or replace backtest equivalents

- [ ] **Singleton patterns still present** (deprecated but not removed):
  - `getStorageEngine()` in StorageEngine.ts
  - `getDefaultPythonEngine()` in python-engine.ts
  - `getAnalyticsEngine()` in AnalyticsEngine.ts
  - **Action**: Use CommandContext or WorkflowContext factory pattern instead

#### Path Forward

1. **Immediate**: Delete `packages/backtest/src/sim/` (duplicated code)
2. **Short-term**: Remove deprecated files marked above
3. **Medium-term**: Consolidate simulation entry points to canonical patterns
4. **Long-term**: Ensure Research OS contracts align with backtest package architecture

### Phase 2: Modes Contract Implementation

The "Modes" contract enables institutional memory by fully defining runs with reproducible configs.

#### Core Implementation

- [ ] **Mode Preset Schema** - Create mode configuration object with:
  - `mode`: `"cheap" | "serious" | "war_room"`
  - `data_window`: train/test lengths, folds
  - `search`: trials, sampler type, bounds
  - `gates`: min WR, max DD, min n, etc.
  - `stress_lanes`: which lanes + multipliers
  - `objective_weights`: dd penalty curve, timing boosts, tail bonuses
  - `seed`: deterministic randomness
  - `data_fingerprint`: alerts table hash + slice version
  - `code_fingerprint`: git commit hash

- [ ] **Config Storage & Hashing** - Store and hash:
  - `config_json` - Full mode configuration
  - `config_hash` - SHA256 of canonical JSON
  - `data_hash` - Data fingerprint
  - `commit_hash` - Git commit SHA

- [ ] **Mode Presets** - Implement three preset configurations:
  - **CHEAP** (iteration / UI tuning):
    - trials: 100-300
    - folds: 2-3
    - lanes: `baseline`, `worse`, `latency_1`
    - champion count: 1 per island
    - fast fail on dead candidates
  - **SERIOUS** (weekly / decision-making):
    - trials: 1k-10k (progressive until convergence)
    - folds: 5-8
    - lanes: baseline + worse + ugly + latency_1 + latency_2 + gap_model
    - require "island stability" (multiple nearby params pass)
  - **WAR_ROOM** (pre-deploy / "prove it"):
    - folds: more, with varied regimes
    - lanes: everything + adversarial (fee spikes, slippage spikes, delayed exits)
    - "regime split" evaluation and maximin across regimes and lanes

- [ ] **Lane Packs** - Add first-class concept:
  - `lane_pack="lite" | "full" | "adversarial"`
  - CHEAP uses `lite`, SERIOUS uses `full`, WAR_ROOM uses `adversarial`

- [ ] **CLI Integration** - Accept `--mode cheap|serious|war_room` flag
  - Every run prints: `MODE=cheap CONFIG_HASH=... DATA_HASH=... COMMIT=...`

- [ ] **API Endpoints** - Add mode-aware endpoints:
  - `POST /api/v1/optimization/runs` - Create optimization run with mode preset
  - `GET /api/v1/optimization/runs/:runId` - Get run with mode metadata
  - `GET /api/v1/modes/presets` - List available mode presets
  - `POST /api/v1/modes/presets` - Create custom mode preset

#### Reproducibility Features

- [ ] **Run Fingerprinting** - Generate run identifiers:
  - Format: `{MODE}@sha256:{config_hash}` on `data@sha256:{data_hash}` at `commit {commit_hash}`
  - Enables exact reproduction and comparison

- [ ] **Run Comparison** - Compare runs by fingerprints:
  - `GET /api/v1/runs/compare` - Compare two runs by config/data/commit hashes
  - Highlight differences in config, data, or code

### Phase 3: Web UI Upgrade

Upgrade to web UI that utilizes the API for mode-aware optimization runs.

- [ ] **Mode Selection UI** - Create interface for:
  - Selecting mode preset (CHEAP/SERIOUS/WAR_ROOM)
  - Viewing mode configuration details
  - Custom mode preset creation/editing

- [ ] **Run Management Dashboard**:
  - List runs with mode badges and fingerprints
  - Filter/search by mode, config hash, data hash, commit
  - Run comparison interface
  - Run reproduction workflow

- [ ] **Real-time Run Monitoring**:
  - WebSocket integration for live run progress
  - Trial-by-trial updates for CHEAP mode
  - Convergence tracking for SERIOUS mode
  - Lane/stress test progress for WAR_ROOM mode

- [ ] **Results Visualization**:
  - Mode-specific result views (quick iteration vs. deep analysis)
  - Island stability visualization for SERIOUS mode
  - Regime split analysis for WAR_ROOM mode
  - Config comparison charts

- [ ] **Institutional Memory Browser**:
  - Search runs by fingerprint components
  - View run lineage (which configs led to which results)
  - Reproduce any historical run with one click
