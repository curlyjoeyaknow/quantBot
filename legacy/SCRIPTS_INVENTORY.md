# Current Package.json Scripts Inventory

This document lists all npm scripts in the root `package.json` and notes which ones will be replaced by Golden Path equivalents.

## Build & Test Scripts (Keep)

- `build:packages` - Build all packages
- `test:packages` - Test all packages
- `build`, `build:watch` - Build commands
- `test`, `test:watch`, `test:coverage`, `test:ci` - Test commands
- `lint`, `lint:fix`, `format` - Code quality

## Database & Infrastructure (Keep)

- `clickhouse:start`, `clickhouse:stop`, `clickhouse:setup`, `clickhouse:migrate` - ClickHouse management
- `influxdb:start`, `influxdb:stop`, `influxdb:migrate`, `influxdb:test` - InfluxDB (legacy, may deprecate)

## Golden Path Scripts (New - Will Replace Old)

### Ingestion
- **NEW:** `ingest:telegram` - Import Telegram exports → Postgres
- **NEW:** `ingest:ohlcv` - Fetch OHLCV for calls → ClickHouse

### Simulation
- **NEW:** `simulate:calls` - Run strategy on selection of calls

### Old Scripts (Will Be Deprecated)
- `extract:brook7` - Old extraction, replace with `ingest:telegram`
- `extract:all-brook` - Old extraction, replace with `ingest:telegram`
- `extract:lsy` - Old extraction, replace with `ingest:telegram`
- `simulate:caller` - Old simulation, replace with `simulate:calls`
- `simulate:config` - Old simulation, replace with `simulate:calls`

## Analysis Scripts (Keep for Now)

- `analyze:callers` - Caller analysis
- `analyze:lsy` - LSY analysis
- `analyze:brook` - Brook analysis
- `score:tokens` - Token scoring
- `score:unified-calls` - Unified calls scoring
- `view:results`, `view:results:html` - Results viewing
- `check:clickhouse` - ClickHouse data checks

## Migration Scripts (Keep)

- `migrate:add-mcap` - Add MCAP column
- `backfill:mcap` - Backfill MCAP data
- `caller:migrate`, `caller:stats` - Caller migration

## Optimization Scripts (Move to legacy/experimental/)

- `optimize:strategies` - Strategy optimization
- `optimize:ml` - ML optimization
- `optimize:analyze` - Optimization analysis
- `optimize:all` - Run all optimizations

## Monitoring Scripts (Keep, but mark as secondary)

- `monitor:brook` - Brook monitoring
- `forward:brook` - Brook forwarding
- `monitor:credits` - Credit monitoring

## Legacy Scripts (Already in legacy/)

- `extract` - Legacy extraction
- `simulate` - Legacy simulation
- `simulate:influxdb` - Legacy InfluxDB simulation
- `dashboard` - Legacy dashboard export

## Bot Scripts (Keep, but mark as secondary)

- `start` - Start bot
- `dev` - Dev mode bot

