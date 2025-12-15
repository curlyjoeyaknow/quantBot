# Archive Directory

This directory contains archived packages and components that are not currently in use but are preserved for future reference.

## Archived Items

### packages/api
**Archived:** 2025-12-14  
**Reason:** Not needed in current stack

The API package provided a Fastify-based REST API server exposing endpoints for:
- OHLCV data queries
- Token metadata and calls
- Simulation results
- Ingestion endpoints
- Health checks

**Documentation:** See `archive/docs-api/API_DOCUMENTATION.md` for complete details.

### packages/monitoring
**Archived:** 2025-12-14  
**Reason:** Not needed in current stack

The monitoring package provided real-time token monitoring, live alerts, and Telegram call ingestion. It included:
- Real-time price streaming via WebSocket/gRPC
- Live trade alerts (entry/exit signals)
- Technical indicator monitoring (Tenkan/Kijun)
- Telegram call ingestion (Brook, CurlyJoe channels)
- Pump.fun lifecycle tracking

**Documentation:** See `docs/MONITORING_PACKAGE.md` for complete details.

### scripts/monitoring
**Archived:** 2025-12-14  
**Reason:** Related to monitoring package

Monitoring-related scripts including:
- Dashboard scripts
- Benchmark scripts
- Brook monitoring scripts

### CLI Command: monitoring.ts
**Archived:** 2025-12-14  
**Location:** `archive/cli-monitoring-command.ts`

CLI command module for monitoring operations.

### TUI Panel: monitoring-panel.ts
**Archived:** 2025-12-14  
**Location:** `archive/tui-monitoring-panel.ts`

TUI screen for monitoring panel.

## Restoring Archived Items

To restore any archived item:

1. Move the item back to its original location
2. Update package.json dependencies if needed
3. Uncomment any commented-out imports/registrations
4. Update documentation references
5. Run `pnpm install` to restore dependencies

## Notes

- All archived items are preserved with their full functionality
- Dependencies may need to be updated if restored
- Some scripts may reference archived packages and will need updates

