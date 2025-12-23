# Task 1.3: Canonical Run Artifact + Hashing Contract

## Status: ✅ COMPLETE

## Overview

Implemented a canonical run artifact system with manifest-based hashing for simulation runs. This enables:
- **Portability**: Any run can be re-run from manifest alone (assuming snapshot exists)
- **Comparability**: Two runs can be compared by fingerprints without guessing what changed
- **Reproducibility**: All inputs are hashed and versioned

## Deliverables

### 1. RunManifest Schema

**Location**: `packages/core/src/artifacts/run-manifest.ts`

The manifest includes:
- `run_id`: Deterministic run identifier
- `seed`: Random seed used for deterministic execution
- `git_sha`: Git commit SHA at time of run
- `data_snapshot_hash`: Hash of input data snapshot (candles, calls)
- `strategy_hash`: Hash of strategy configuration
- `execution_model_hash`: Hash of execution model configuration (optional)
- `cost_model_hash`: Hash of cost model configuration (optional)
- `risk_model_hash`: Hash of risk model configuration (optional)
- `engine_version`: Engine version (defaults to '1.0.0')
- `fingerprint`: Single hash of all inputs (run fingerprint)
- `created_at`: Timestamp when run was created
- `command`: Command that generated this run (optional)
- `package_name`: Package name (optional)
- `metadata`: Additional metadata (optional)

### 2. Run Artifact Directory Layout

**Location**: `packages/core/src/artifacts/artifact-schema.ts`

Standardized directory structure:
```
artifacts/
  {run_id}/
    manifest.json          - Run manifest (required)
    events.ndjson          - Simulation events (one per line, NDJSON)
    metrics.json           - Aggregated metrics
    positions.ndjson       - Position snapshots (one per line, NDJSON)
    debug.log              - Optional debug logs
```

Legacy files (for backward compatibility):
- `results.json` - Legacy results format
- `events.csv` - Legacy CSV format
- `logs.txt` - Legacy logs format

### 3. hashInputs() Function

**Location**: `packages/core/src/artifacts/run-manifest.ts`

The `hashInputs()` function produces a deterministic "run fingerprint" from all run inputs:

```typescript
export function hashInputs(components: RunInputComponents): string
```

This function:
- Creates canonical representation (sorted keys for determinism)
- Serializes to JSON (no whitespace)
- Hashes with SHA256
- Returns hex string (64 chars)

### 4. Run Manifest Service

**Location**: `packages/cli/src/core/run-manifest-service.ts`

Service that:
- Creates run manifests from components
- Writes manifests to disk
- Reads manifests from disk
- Integrates with artifact manager

### 5. Integration with Execute Function

**Location**: `packages/cli/src/core/execute.ts`

The `execute()` function now:
- Automatically creates manifests for all runs
- Extracts manifest components from handler results (if available)
- Falls back to minimal manifest if components not available
- Writes NDJSON artifacts (events.ndjson, positions.ndjson)
- Maintains backward compatibility with legacy formats

## Usage

### Creating a Manifest from Handler Result

Handlers can return a result with `_manifest` property:

```typescript
return {
  // ... normal result ...
  _manifest: {
    seed: 12345,
    strategyConfig: { /* strategy config */ },
    dataSnapshot: {
      calls: [{ mint: '...', alertTimestamp: '...' }],
      candles: [{ mint: '...', fromISO: '...', toISO: '...' }],
    },
    executionModel: { /* execution model */ },
    costModel: { /* cost model */ },
    riskModel: { /* risk model */ },
  },
};
```

### Reading a Manifest

```typescript
import { readRunManifest } from '@quantbot/cli/core/run-manifest-service';

const manifest = await readRunManifest(artifactPaths);
if (manifest) {
  console.log('Fingerprint:', manifest.fingerprint);
  console.log('Strategy hash:', manifest.strategy_hash);
}
```

### Comparing Runs

```typescript
const manifest1 = await readRunManifest(paths1);
const manifest2 = await readRunManifest(paths2);

if (manifest1 && manifest2) {
  if (manifest1.fingerprint === manifest2.fingerprint) {
    console.log('Runs are identical');
  } else {
    console.log('Runs differ');
    if (manifest1.strategy_hash !== manifest2.strategy_hash) {
      console.log('Strategy changed');
    }
    if (manifest1.data_snapshot_hash !== manifest2.data_snapshot_hash) {
      console.log('Data snapshot changed');
    }
  }
}
```

## Success Criteria

✅ **Any run can be re-run from the manifest alone** (assuming snapshot exists)
- Manifest contains all input hashes
- Fingerprint uniquely identifies run configuration
- Git SHA enables code version tracking

✅ **Two runs can be compared by fingerprints without guessing what changed**
- `fingerprint` is single hash of all inputs
- Individual hashes (strategy, data, execution model, etc.) enable granular comparison
- Deterministic hashing ensures same inputs → same fingerprint

## Files Created/Modified

### Created
- `packages/core/src/artifacts/run-manifest.ts` - Run manifest schema and hashing
- `packages/core/src/artifacts/artifact-schema.ts` - Artifact directory structure
- `packages/core/src/artifacts/index.ts` - Artifacts module exports
- `packages/cli/src/core/run-manifest-service.ts` - Run manifest service
- `docs/TASK_1_3_RUN_MANIFEST.md` - This document

### Modified
- `packages/core/src/index.ts` - Added artifacts exports
- `packages/cli/src/core/artifact-manager.ts` - Updated artifact paths and added NDJSON support
- `packages/cli/src/core/execute.ts` - Integrated manifest creation

## Next Steps

1. **Task 1.4**: Golden Dataset Snapshot + Replay CLI
   - Create `data/snapshots/golden/<name>/manifest.json`
   - Implement `simulation replay --run-id <id>` command
   - Implement `simulation run --snapshot golden:<name> --seed <seed>` command
   - Add CI job for golden replay and determinism tests

2. **Task 2.0**: Throughput - Parallel Sweeps with Early Stopping
   - Implement sweep runner with parallelization
   - Add "abort losers early" functionality
   - Build leaderboard aggregator
   - Add minimal caching for snapshot reads

## Notes

- **Determinism**: All hashing uses sorted keys and canonical JSON serialization to ensure determinism
- **Backward Compatibility**: Legacy artifact formats (results.json, events.csv, logs.txt) are still written for compatibility
- **Extensibility**: Handlers can provide manifest components via `_manifest` property in result
- **Fallback**: If manifest components are not available, a minimal manifest is created with run ID and seed

