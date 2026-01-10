# Interface Freeze Document

**Date**: 2025-01-25  
**Status**: ACTIVE - All interfaces listed below are FROZEN

## Purpose

This document lists all ports/interfaces that must not be mutated. From this point forward:
- ✅ **ADD** new interfaces/ports
- ✅ **ADD** new optional fields to existing interfaces
- ❌ **NEVER** mutate existing required fields
- ❌ **NEVER** remove fields
- ❌ **NEVER** change field types

## Frozen Interfaces

### Core Types (`@quantbot/core`)

#### Slice Types (`packages/core/src/slices/types.ts`)

**FROZEN**:
- `SliceManifestV1` - Version 1 manifest structure
- `SliceSpec` - Slice specification
- `ParquetLayoutSpec` - Parquet layout specification
- `RunContext` - Run context structure
- `SliceAnalysisSpec` - Analysis specification
- `SliceAnalysisResult` - Analysis result structure
- `ExportAndAnalyzeResult` - Export and analyze result

**Allowed**: Adding new optional fields, creating `SliceManifestV2` if needed

#### Port Interfaces (`packages/core/src/ports/`)

**FROZEN**:
- `SliceExporter` port (`slice-exporter-port.ts`)
- `SliceAnalyzer` port (`slice-analyzer-port.ts`)

**Allowed**: Adding new port methods (must be optional or new ports)

### Storage Interfaces (`@quantbot/storage`)

#### Repository Interfaces

**FROZEN**:
- `OhlcvRepository` - ClickHouse OHLCV operations
  - `upsertCandles()` signature
  - `getCandles()` signature
  - `hasCandles()` signature

**Allowed**: Adding new methods, adding optional parameters

#### Adapter Interfaces

**FROZEN**:
- `ClickHouseSliceExporterAdapterImpl` - Export implementation contract
- `DuckDbSliceAnalyzerAdapterImpl` - Analysis implementation contract

**Allowed**: Adding new adapter implementations, extending existing ones

### Workflow Interfaces (`@quantbot/workflows`)

**FROZEN**:
- `exportAndAnalyzeSlice()` function signature
- `runSimPresets()` function signature (from `packages/workflows/src/slices/runSimPresets.ts`)

**Allowed**: Adding new optional parameters, creating new workflow functions

### Lab Interfaces (`scripts/lab-sim.wiring.ts`)

**FROZEN**:
- `CandleSliceProvider` port
- `FeatureComputer` port
- `Simulator` port
- `SummaryIngester` port

**Allowed**: Adding new optional methods, creating new ports

## Versioning Strategy

### When Breaking Changes Are Required

1. **Create new version**: `SliceManifestV2`, `SliceSpecV2`, etc.
2. **Maintain backward compatibility**: Support both versions during transition
3. **Document migration path**: Clear guide for moving from V1 to V2
4. **Deprecation period**: Mark V1 as deprecated, remove after 6 months

### Example Versioning Pattern

```typescript
// V1 (FROZEN)
export interface SliceManifestV1 {
  version: 1;
  // ... existing fields
}

// V2 (NEW - can add required fields)
export interface SliceManifestV2 {
  version: 2;
  // ... all V1 fields
  // ... new required fields
}

// Adapter supports both
export function readManifest(data: unknown): SliceManifestV1 | SliceManifestV2 {
  const parsed = JSON.parse(data);
  if (parsed.version === 2) return parsed as SliceManifestV2;
  return parsed as SliceManifestV1;
}
```

## Enforcement

### ESLint Rules

ESLint rules are configured to prevent:
- Mutating frozen interface types
- Removing required fields
- Changing field types

See `.eslintrc` for specific rules.

### Code Review Checklist

Before merging PRs that touch frozen interfaces:
- [ ] No required fields removed
- [ ] No field types changed
- [ ] New fields are optional OR new version created
- [ ] Migration path documented (if version bump)

## Exceptions

**No exceptions without explicit approval from architecture review.**

If you need to break a frozen interface:
1. Create RFC document
2. Get architecture review approval
3. Create new version
4. Document migration path
5. Update this document


