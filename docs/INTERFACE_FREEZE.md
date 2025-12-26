# QuantBot Lab — Interface Freeze

## Rule: Only ADD, never mutate
From this point onward, ports and manifest schemas are append-only:
- ✅ Add new fields (optional preferred)
- ✅ Add new interfaces/ports
- ✅ Add new adapter implementations
- ❌ Rename fields
- ❌ Change semantics of existing fields
- ❌ Remove fields
- ❌ Change output shapes

If a breaking change is unavoidable:
- create a v2 schema/interface in a new file
- keep v1 support until migration is complete

## Frozen Contracts (initial set)
### Manifests
- Slice Manifest v1: `packages/workflows/src/slices/manifest.schema.v1.json`
- Feature Manifest v1: `packages/lab/src/features/feature.manifest.schema.v1.json`
- Simulation Summary v1: `packages/lab/src/simulation/sim.summary.schema.v1.json`

### Storage Ports
- `packages/storage/src/ports/CandleSlicePort.ts`
- `packages/storage/src/ports/FeatureComputePort.ts`
- `packages/storage/src/ports/SimulationPort.ts`
- `packages/storage/src/ports/LeaderboardPort.ts`

### Workflow APIs
- `packages/workflows/src/lab/runLabPreset.ts`
- `packages/workflows/src/lab/runRollingWindows.ts`
- `packages/workflows/src/lab/runOptimization.ts`

## Lint / CI ripwire guidance
Add CI checks that fail on:
- schema file edits (except additive)
- port signature edits (except additive optional props)

Practical approach:
- code owners for `ports/` and `*.schema.*`
- a "diff guard" script that validates changes are additive (later)
