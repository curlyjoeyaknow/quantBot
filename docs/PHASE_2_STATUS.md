# Phase 2: RunManifest + SnapshotRef Spine - Status

## Goal
Make RunManifest + SnapshotRef the spine of the research lab:
- Every run writes: manifest + metrics + events ✅ (already done in execute.ts)
- Snapshot refs as required inputs ⚠️ (partially done - DataSnapshotService exists but not enforced)
- Re-run from manifest as first-class command ❌ (not implemented)

## Current State

### ✅ Manifest + Metrics + Events Writing
- `execute.ts` already writes:
  - `manifest.json` (via `createAndWriteRunManifest`)
  - `metrics.json` (run metadata)
  - `events.ndjson` (if result has events)
  - `positions.ndjson` (if result has positions)
- This is working correctly

### ⚠️ Snapshot Refs as Required Inputs
- `DataSnapshotService` exists and can create/load snapshots
- `DataSnapshotRef` contract is defined
- BUT: Current simulation commands don't require snapshots
  - `simulation run` uses `SimulationRunSpec` (no snapshot requirement)
  - `simulation run-duckdb` uses direct DuckDB queries (no snapshot requirement)
  - `research run` uses `SimulationRequest` (has snapshot, but adapter is stub)

### ❌ Re-run from Manifest
- No command exists to replay a simulation from a manifest file
- Would need to:
  1. Load manifest.json
  2. Extract snapshot ref, strategy ref, models, config
  3. Re-run simulation with same inputs
  4. Verify outputs match (optional)

## Implementation Plan

### Step 1: Make Snapshots Required for Research Commands
- Update `research run` command to require snapshot creation first
- Or: Auto-create snapshot if not provided
- Update `ResearchSimulationAdapter` to actually use snapshots (currently stub)

### Step 2: Create Re-run Command
- New command: `research replay <manifest-path>`
- Loads manifest, extracts all inputs, re-runs simulation
- Validates that outputs are deterministic (same run ID, same results)

### Step 3: Update Simulation Commands to Use Snapshots (Optional)
- Migrate `simulation run` to use snapshots
- This is a bigger change and can be done later

## Next Steps
1. Implement `ResearchSimulationAdapter.run()` to actually use snapshots
2. Create `research replay` command
3. Add snapshot validation to ensure data integrity

