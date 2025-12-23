# Research Services Integration Guide

This guide explains how to integrate `DataSnapshotService` and `ExecutionRealityService` into your workflows and production code.

## Architecture Overview

The Research Services are designed to work with the WorkflowContext pattern:

```
WorkflowContext
    ↓
DataSnapshotService / ExecutionRealityService
    ↓
Real Data Sources / Execution Models
```

## Integration Patterns

### Pattern 1: Direct Service Instantiation

Use this pattern when you need services in a workflow or script:

```typescript
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

export async function myWorkflow() {
  // Create context
  const ctx = createProductionContext();
  
  // Create services
  const dataService = new DataSnapshotService(ctx);
  const executionService = new ExecutionRealityService(ctx);
  
  // Use services
  const snapshot = await dataService.createSnapshot({ /* ... */ });
  const model = executionService.createExecutionModelFromCalibration({ /* ... */ });
}
```

### Pattern 2: Service Factory Functions

Create reusable factory functions for services:

```typescript
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';
import type { WorkflowContext } from '@quantbot/workflows/types';

export function createResearchServices(ctx: WorkflowContext) {
  return {
    dataSnapshot: new DataSnapshotService(ctx),
    executionReality: new ExecutionRealityService(ctx),
  };
}

// Usage
const ctx = createProductionContext();
const services = createResearchServices(ctx);
const snapshot = await services.dataSnapshot.createSnapshot({ /* ... */ });
```

### Pattern 3: WorkflowContext Extension

Extend WorkflowContext to include services (for advanced use cases):

```typescript
import type { WorkflowContext } from '@quantbot/workflows/types';
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';

export type ExtendedWorkflowContext = WorkflowContext & {
  research: {
    dataSnapshot: DataSnapshotService;
    executionReality: ExecutionRealityService;
  };
};

export function createExtendedContext(base: WorkflowContext): ExtendedWorkflowContext {
  return {
    ...base,
    research: {
      dataSnapshot: new DataSnapshotService(base),
      executionReality: new ExecutionRealityService(base),
    },
  };
}
```

## Integration with Experiment Runner

The services integrate seamlessly with the experiment runner:

```typescript
import { runSingleSimulation } from '@quantbot/workflows/research';
import { createExperimentContext } from '@quantbot/workflows/research/context';
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

async function runExperiment() {
  // Create contexts
  const workflowCtx = createProductionContext();
  const experimentCtx = createExperimentContext({
    workflowContext: workflowCtx,
  });
  
  // Create services
  const dataService = new DataSnapshotService(workflowCtx);
  const executionService = new ExecutionRealityService(workflowCtx);
  
  // Prepare simulation request
  const snapshot = await dataService.createSnapshot({ /* ... */ });
  const executionModel = executionService.createExecutionModelFromCalibration({ /* ... */ });
  const costModel = executionService.createCostModelFromFees({ /* ... */ });
  const riskModel = executionService.createRiskModelFromConstraints({ /* ... */ });
  
  // Run simulation
  const artifact = await runSingleSimulation({
    dataSnapshot: snapshot,
    strategy: { /* ... */ },
    executionModel,
    costModel,
    riskModel,
    runConfig: { seed: 12345 },
  }, experimentCtx);
  
  return artifact;
}
```

## Integration with CLI Commands

For CLI commands, use CommandContext:

```typescript
import { defineCommand } from '@quantbot/cli/core/defineCommand';
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';
import type { CommandContext } from '@quantbot/cli/core/command-context';

export const createSnapshotCommand = defineCommand({
  name: 'create-snapshot',
  description: 'Create a data snapshot',
  handler: async (args, ctx: CommandContext) => {
    // Create workflow context from command context
    const workflowCtx = {
      clock: { nowISO: () => new Date().toISOString() },
      ids: { generate: () => ctx.services.ids?.generate() || crypto.randomUUID() },
      logger: ctx.logger,
      // ... other context properties
    };
    
    const dataService = new DataSnapshotService(workflowCtx);
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: args.from,
        toISO: args.to,
      },
      sources: [{ venue: args.venue }],
    });
    
    return snapshot;
  },
});
```

## Dependency Injection

For testability, use dependency injection:

```typescript
interface ResearchServices {
  dataSnapshot: DataSnapshotService;
  executionReality: ExecutionRealityService;
}

export function createResearchServices(ctx: WorkflowContext): ResearchServices {
  return {
    dataSnapshot: new DataSnapshotService(ctx),
    executionReality: new ExecutionRealityService(ctx),
  };
}

// In tests, you can mock the services
export function createMockResearchServices(): ResearchServices {
  return {
    dataSnapshot: {
      createSnapshot: vi.fn(),
      loadSnapshot: vi.fn(),
      verifySnapshot: vi.fn(),
    },
    executionReality: {
      createExecutionModelFromCalibration: vi.fn(),
      // ... other methods
    },
  };
}
```

## Error Handling Integration

Services throw errors that should be handled at the workflow level:

```typescript
import { ValidationError } from '@quantbot/utils';

export async function myWorkflow() {
  const ctx = createProductionContext();
  const dataService = new DataSnapshotService(ctx);
  
  try {
    const snapshot = await dataService.createSnapshot({ /* ... */ });
  } catch (error) {
    if (error instanceof ValidationError) {
      ctx.logger.error('Invalid snapshot parameters', { error });
      return { success: false, error: error.message };
    }
    
    ctx.logger.error('Failed to create snapshot', { error });
    throw error; // Re-throw unexpected errors
  }
}
```

## Performance Optimization

### Caching Snapshots

Cache snapshots to avoid re-creation:

```typescript
const snapshotCache = new Map<string, DataSnapshotRef>();

async function getOrCreateSnapshot(key: string, params: CreateSnapshotParams) {
  if (snapshotCache.has(key)) {
    return snapshotCache.get(key)!;
  }
  
  const snapshot = await dataService.createSnapshot(params);
  snapshotCache.set(key, snapshot);
  return snapshot;
}
```

### Batch Operations

Batch multiple operations for better performance:

```typescript
// Create multiple snapshots in parallel
const snapshots = await Promise.all([
  dataService.createSnapshot({ /* ... */ }),
  dataService.createSnapshot({ /* ... */ }),
  dataService.createSnapshot({ /* ... */ }),
]);
```

## Testing Integration

### Unit Tests

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataSnapshotService } from '@quantbot/workflows/research/services';
import { createProductionContext } from '@quantbot/workflows/context/createProductionContext';

describe('My Workflow', () => {
  let ctx: ReturnType<typeof createProductionContext>;
  let dataService: DataSnapshotService;
  
  beforeEach(() => {
    ctx = createProductionContext();
    dataService = new DataSnapshotService(ctx);
  });
  
  it('creates snapshot correctly', async () => {
    const snapshot = await dataService.createSnapshot({
      timeRange: {
        fromISO: '2024-01-01T00:00:00Z',
        toISO: '2024-01-02T00:00:00Z',
      },
      sources: [{ venue: 'pump.fun' }],
    });
    
    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import { runSingleSimulation } from '@quantbot/workflows/research';
import { createExperimentContext } from '@quantbot/workflows/research/context';
import { DataSnapshotService, ExecutionRealityService } from '@quantbot/workflows/research/services';

describe('End-to-End Integration', () => {
  it('runs complete simulation with services', async () => {
    const ctx = createProductionContext();
    const experimentCtx = createExperimentContext({ workflowContext: ctx });
    
    const dataService = new DataSnapshotService(ctx);
    const executionService = new ExecutionRealityService(ctx);
    
    // ... create snapshot and models ...
    
    const artifact = await runSingleSimulation(request, experimentCtx);
    
    expect(artifact.metadata.runId).toBeDefined();
    expect(artifact.metrics).toBeDefined();
  });
});
```

## Migration Guide

### From Mock Services

If you were using mock services, migrate like this:

```typescript
// Before (mocks)
const mockDataService = new MockDataSnapshotService();
const snapshot = mockDataService.createSnapshot({ /* ... */ });

// After (real services)
const ctx = createProductionContext();
const dataService = new DataSnapshotService(ctx);
const snapshot = await dataService.createSnapshot({ /* ... */ }); // Note: async
```

### From Direct Data Access

If you were accessing data directly, migrate to snapshots:

```typescript
// Before (direct access)
const calls = await queryCallsDuckdb({ /* ... */ });
const candles = await storageEngine.getCandles(/* ... */ });

// After (snapshots)
const snapshot = await dataService.createSnapshot({ /* ... */ });
const data = await dataService.loadSnapshot(snapshot);
// Use data.calls and data.candles
```

## Best Practices

1. **Always use WorkflowContext**: Services require WorkflowContext for proper dependency injection
2. **Handle errors gracefully**: Services can throw ValidationError and other errors
3. **Cache snapshots**: Reuse snapshots across multiple simulations
4. **Verify integrity**: Always verify snapshot integrity before using in production
5. **Use seeded randomness**: For reproducible simulations, use seeded random number generators
6. **Monitor performance**: Large snapshots can be slow to create/load

## Troubleshooting

### Service requires WorkflowContext

**Error**: `TypeError: Cannot read property 'clock' of undefined`

**Solution**: Always pass a WorkflowContext when creating services:

```typescript
const ctx = createProductionContext();
const service = new DataSnapshotService(ctx); // ✅ Correct
const service = new DataSnapshotService(); // ❌ Wrong
```

### Snapshot integrity check fails

**Error**: `Snapshot integrity check failed`

**Solution**: This means the data has changed. Recreate the snapshot:

```typescript
const snapshot = await dataService.createSnapshot({ /* ... */ });
// ... later ...
const isValid = await dataService.verifySnapshot(snapshot);
if (!isValid) {
  // Recreate snapshot
  const newSnapshot = await dataService.createSnapshot({ /* ... */ });
}
```

### Calibration requires samples

**Error**: `Cannot calibrate execution model from empty records`

**Solution**: Provide at least one latency sample and one slippage sample:

```typescript
const model = executionService.createExecutionModelFromCalibration({
  latencySamples: [100, 200, 300], // At least one
  slippageSamples: [
    {
      tradeSize: 100,
      expectedPrice: 100,
      actualPrice: 100.1,
      marketVolume24h: 1000000,
    },
  ],
  failureRate: 0.01,
});
```

## See Also

- [Usage Guide](./research-services-usage.md) - Detailed usage examples
- [Research OS Contract](../SIMULATION_CONTRACT.md) - Contract specification
- [Testing Summary](../../packages/workflows/src/research/TESTING_SUMMARY.md) - Test examples

