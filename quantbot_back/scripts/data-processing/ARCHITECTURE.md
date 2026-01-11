# Data Processing Scripts Architecture

## Current Structure

These scripts are **standalone Python utilities** in `scripts/data-processing/`:
- `export_candles_parquet.py` - Export from ClickHouse to Parquet
- `duck_query_candles.py` - Query Parquet with DuckDB
- `candles_query.py` - Unified query interface
- `query_duckdb_clickhouse.py` - Compare/sync/join operations

## When to Use Standalone Scripts vs CLI Commands

### ✅ Standalone Scripts (Current Approach)

**Use for:**
- One-off data operations
- Research/experimentation
- Batch processing scripts
- Utilities that don't need CLI integration
- Scripts run directly: `python scripts/data-processing/...`

**Location:** `scripts/data-processing/`

### ✅ CLI Commands (If Needed)

**Use for:**
- Operations users run frequently
- Operations that need to be part of `quantbot` CLI
- Operations that need consistent error handling/formatting
- Operations that should be testable via handler pattern

**Required Structure:**

```
tools/data-processing/
  └── export_candles.py          # Python script (called via PythonEngine)

packages/storage/src/
  └── candle-export-service.ts   # Service wraps PythonEngine, validates with Zod

packages/cli/src/
  ├── handlers/storage/
  │   └── export-candles.ts      # Pure handler, calls service
  └── commands/
      └── storage.ts             # Command metadata, schema, registration
```

## Handler/Service Pattern (If Converting to CLI)

### 1. Python Script (`tools/data-processing/export_candles.py`)

```python
#!/usr/bin/env python3
"""
Export candles from ClickHouse to Parquet.
Called via PythonEngine from TypeScript service.
"""

import json
import sys
from typing import Dict, Any

def main():
    # Read JSON config from stdin
    config = json.load(sys.stdin)
    
    # Execute operation
    result = export_candles(
        mint=config['mint'],
        n=config['n'],
        # ... other params
    )
    
    # Return JSON result
    print(json.dumps(result))

if __name__ == '__main__':
    main()
```

### 2. Service (`packages/storage/src/candle-export-service.ts`)

```typescript
import { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

const ExportResultSchema = z.object({
  success: z.boolean(),
  filesWritten: z.number(),
  totalRows: z.number(),
  error: z.string().optional(),
});

export class CandleExportService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  async exportCandles(
    mint: string,
    n: number,
    // ... other params
  ): Promise<z.infer<typeof ExportResultSchema>> {
    const result = await this.pythonEngine.runScript(
      'tools/data-processing/export_candles.py',
      {
        mint,
        n,
        // ... other params
      },
      ExportResultSchema
    );
    
    return result;
  }
}
```

### 3. Handler (`packages/cli/src/handlers/storage/export-candles.ts`)

```typescript
import type { CommandContext } from '../../core/command-context.js';
import type { z } from 'zod';

export type ExportCandlesArgs = z.infer<typeof exportCandlesSchema>;

export async function exportCandlesHandler(
  args: ExportCandlesArgs,
  ctx: CommandContext
) {
  const service = ctx.services.candleExport(); // Service from context
  return await service.exportCandles(
    args.mint,
    args.n,
    // ... other params
  );
}
```

### 4. Command (`packages/cli/src/commands/storage.ts`)

```typescript
export const exportCandlesSchema = z.object({
  mint: z.string(),
  n: z.number().int().positive().default(10000),
  // ... other fields
});

const storageModule: PackageCommandModule = {
  packageName: 'storage',
  commands: [
    {
      name: 'export-candles',
      description: 'Export candles from ClickHouse to Parquet',
      schema: exportCandlesSchema,
      handler: async (args, ctx) => {
        const typedArgs = args as z.infer<typeof exportCandlesSchema>;
        return await exportCandlesHandler(typedArgs, ctx);
      },
      examples: ['quantbot storage export-candles --mint So111... --n 10000'],
    },
  ],
};
```

## Key Rules

### Handler Rules (from `.cursor/rules/packages-cli-handlers.mdc`)

- ✅ Pure function: takes args + context, returns data
- ❌ NO console.log, process.exit, try/catch
- ❌ NO direct PythonEngine calls (use service)
- ❌ NO output formatting (executor does this)

### Service Rules

- ✅ Wraps PythonEngine calls
- ✅ Validates output with Zod schemas
- ✅ Handles errors and logging
- ✅ Returns typed results
- ❌ NO handler-specific logic
- ❌ NO output formatting

### Python Script Rules

- ✅ Reads JSON config from stdin
- ✅ Returns JSON result to stdout
- ✅ Handles errors gracefully
- ❌ NO business logic (keep it simple)
- ❌ NO domain-specific validation (service does this)

## Current Scripts Status

**These scripts are standalone utilities** - they're fine as-is for:
- Ad-hoc data operations
- Research workflows
- One-off batch jobs

**If you need CLI commands**, follow the pattern above to convert them.

## See Also

- `.cursor/rules/packages-cli-handlers.mdc` - Handler pattern rules
- `.cursor/rules/packages-workflows.mdc` - Workflow rules
- `packages/cli/docs/PYTHON_INTEGRATION.md` - Python integration guide

