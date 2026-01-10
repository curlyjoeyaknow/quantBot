# Python Integration Guide

This guide explains how to integrate Python tools into the QuantBot CLI using the handler-first architecture pattern.

## Overview

The Python integration follows the same handler pattern as other CLI commands:

```
handler → service → PythonEngine.run() → output validated by Zod → artifacts referenced by manifest
```

## Architecture

### PythonEngine

The `PythonEngine` class (`packages/utils/src/python/python-engine.ts`) provides a clean abstraction for executing Python scripts:

- Wraps subprocess execution
- Handles JSON input/output
- Validates output against Zod schemas
- Manages timeouts and error handling
- Returns typed results

### CommandContext Integration

The `PythonEngine` is available through `CommandContext`:

```typescript
const engine = ctx.services.pythonEngine();
```

This allows handlers to access Python tools without direct subprocess calls.

## Creating a Python Handler

### 1. Define the Schema

Create a Zod schema for command arguments in the command file:

```typescript
// packages/cli/src/commands/ingestion.ts
export const telegramProcessSchema = z.object({
  file: z.string().min(1),
  outputDb: z.string().min(1),
  chatId: z.string().min(1),
  rebuild: z.boolean().default(false),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});
```

### 2. Create the Handler

Create a handler that uses `PythonEngine`:

```typescript
// packages/cli/src/handlers/ingestion/process-telegram-python.ts
import type { CommandContext } from '../../core/command-context.js';
import { telegramProcessSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';
import type { PythonManifest } from '@quantbot/utils';

export type ProcessTelegramPythonArgs = z.infer<typeof telegramProcessSchema>;

export async function processTelegramPythonHandler(
  args: ProcessTelegramPythonArgs,
  ctx: CommandContext
): Promise<PythonManifest> {
  const engine = ctx.services.pythonEngine();

  return await engine.runTelegramPipeline({
    inputFile: args.file,
    outputDb: args.outputDb,
    chatId: args.chatId,
    rebuild: args.rebuild,
  });
}
```

### 3. Register the Command

Wire the handler to the command registry:

```typescript
// packages/cli/src/commands/ingestion.ts
const ingestionModule: PackageCommandModule = {
  packageName: 'ingestion',
  description: 'Data ingestion operations',
  commands: [
    {
      name: 'telegram-python',
      description: 'Process Telegram export using Python DuckDB pipeline',
      schema: telegramProcessSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof telegramProcessSchema>;
        return await processTelegramPythonHandler(typedArgs, ctx);
      },
      examples: [
        'quantbot ingestion telegram-python --file data/telegram.json --output-db data/output.duckdb --chat-id test_chat',
      ],
    },
  ],
};
```

## PythonEngine API

### Generic Script Execution

```typescript
const result = await engine.runScript<T>(
  scriptPath: string,
  args: Record<string, unknown>,
  schema: z.ZodSchema<T>,
  options?: PythonScriptOptions
): Promise<T>
```

**Example:**

```typescript
const result = await engine.runScript(
  '/path/to/script.py',
  { input: 'data.json', output: 'result.json' },
  ResultSchema,
  { timeout: 60000 }
);
```

### Telegram Pipeline

```typescript
const manifest = await engine.runTelegramPipeline(
  config: TelegramPipelineConfig,
  options?: PythonScriptOptions
): Promise<PythonManifest>
```

**Example:**

```typescript
const manifest = await engine.runTelegramPipeline({
  inputFile: '/path/to/telegram.json',
  outputDb: '/path/to/output.duckdb',
  chatId: 'test_chat',
  rebuild: false,
});
```

## Testing Strategy

### Handler Tests

Test handlers by mocking `PythonEngine`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { processTelegramPythonHandler } from '../../../../src/handlers/ingestion/process-telegram-python.js';

describe('processTelegramPythonHandler', () => {
  it('should call PythonEngine with correct parameters', async () => {
    const mockEngine = {
      runTelegramPipeline: vi.fn().mockResolvedValue({
        chat_id: 'test_chat',
        chat_name: 'Test Chat',
        duckdb_file: '/path/to/output.duckdb',
      }),
    };

    const mockCtx = {
      services: {
        pythonEngine: () => mockEngine,
      },
    } as any;

    const args = {
      file: '/path/to/input.json',
      outputDb: '/path/to/output.duckdb',
      chatId: 'test_chat',
      rebuild: false,
      format: 'table' as const,
    };

    const result = await processTelegramPythonHandler(args, mockCtx);

    expect(mockEngine.runTelegramPipeline).toHaveBeenCalledWith({
      inputFile: args.file,
      outputDb: args.outputDb,
      chatId: args.chatId,
      rebuild: args.rebuild,
    });
    expect(result.chat_id).toBe('test_chat');
  });
});
```

### Contract Tests

Create integration tests that run the actual Python tool:

```typescript
// packages/utils/tests/integration/python-bridge.test.ts
import { PythonEngine } from '@quantbot/utils';

describe('Python Bridge Test', () => {
  it('runs Python tool and validates output schema', async () => {
    const engine = new PythonEngine();
    const manifest = await engine.runTelegramPipeline({
      inputFile: '/path/to/fixture.json',
      outputDb: '/path/to/test.duckdb',
      chatId: 'test_chat',
      rebuild: true,
    });

    expect(manifest.chat_id).toBe('test_chat');
    expect(manifest.duckdb_file).toBe('/path/to/test.duckdb');
  });
});
```

## Python Tool Requirements

Python tools should:

1. **Output JSON on the last line** - `PythonEngine` expects JSON output on stdout's last line
2. **Use standard argument parsing** - Support `--key value` format
3. **Return structured data** - Output should match a Zod schema
4. **Handle errors gracefully** - Exit with non-zero code on failure

**Example Python tool:**

```python
#!/usr/bin/env python3
import argparse
import json
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    
    try:
        # Process data
        result = {
            'input': args.input,
            'output': args.output,
            'rows_processed': 100,
        }
        
        # Output JSON on last line
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
```

## Best Practices

1. **Schema Validation**: Always validate Python tool output with Zod schemas
2. **Error Handling**: Let errors bubble up from handlers (no try/catch in handlers)
3. **Testing**: Mock `PythonEngine` in handler tests, test Python logic separately
4. **Type Safety**: Use TypeScript types for Python tool outputs
5. **Timeout Management**: Set appropriate timeouts for long-running Python scripts

## Example: Complete Integration

See `packages/cli/src/handlers/ingestion/process-telegram-python.ts` for a complete example of:

- Handler implementation
- Schema definition
- Command registration
- Unit tests
- Integration tests

## References

- [CLI Architecture](./CLI_ARCHITECTURE.md) - Handler-first architecture
- [PythonEngine Source](../../packages/utils/src/python/python-engine.ts) - Implementation details
- [Telegram Pipeline Handler](../../packages/cli/src/handlers/ingestion/process-telegram-python.ts) - Example handler

