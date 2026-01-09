# sweep-simulation Handler

## Overview

Runs parameter sweep simulations.

## Location

`packages/cli/src/handlers/research/sweep-simulation.ts`

## Handler Function

`sweepSimulationHandler`

## Command

```bash
quantbot research sweep --sweep-file <path> [options]
```

## Examples

```bash
# Run parameter sweep
quantbot research sweep --sweep-file sweeps/sweep-001.json

# JSON output
quantbot research sweep --sweep-file sweeps/sweep-001.json --format json
```

## Parameters

- `--sweep-file <path>`: Path to sweep configuration file (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  sweepId: string;
  runs: string[];
  results: SweepResults;
}
```

## Related

- [[run-simulation]] - Single simulation
- [[batch-simulation]] - Batch simulations

