# @quantbot/utils

> Shared utilities for QuantBot - logger, EventBus, PythonEngine, validation, and more

## Overview

`@quantbot/utils` provides shared utilities used across the QuantBot monorepo:

- **Logger**: Winston-based logging with file rotation
- **EventBus**: Event-driven architecture support
- **PythonEngine**: Execute Python scripts with Zod validation
- **Validation**: Zod schemas and validation helpers
- **Address Utilities**: Solana address validation and formatting
- **Error Types**: Custom error classes

## Key Exports

### Logger

```typescript
import { logger } from '@quantbot/utils';

logger.info('Message', { context: 'value' });
logger.error('Error', { error: err });
```

### EventBus

```typescript
import { EventBus } from '@quantbot/utils';

const bus = new EventBus();
bus.on('event', (data) => { /* ... */ });
bus.emit('event', data);
```

### PythonEngine

```typescript
import { PythonEngine } from '@quantbot/utils';

const engine = new PythonEngine();
const result = await engine.runScript(
  'tools/script.py',
  { arg1: 'value' },
  ResultSchema
);
```

### Validation

```typescript
import { ValidationError } from '@quantbot/utils';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number(),
});

const result = schema.safeParse(data);
if (!result.success) {
  throw new ValidationError('Invalid data', result.error);
}
```

## Architecture

### Dependencies

- `@quantbot/core` - Foundation types
- `luxon` - Date/time handling
- `winston` - Logging
- `zod` - Validation
- `execa` - Process execution (PythonEngine)

### Build Order

This package must be built **second** (position 2) in the build order:

```bash
# Build dependencies first
pnpm --filter @quantbot/core build

# Then build utils
pnpm --filter @quantbot/utils build
```

## Usage Examples

### Logger Configuration

```typescript
import { logger } from '@quantbot/utils';

// Logger is configured via environment variables:
// LOG_LEVEL=info
// LOG_CONSOLE=true
// LOG_FILE=true
// LOG_DIR=./logs
```

### PythonEngine with Validation

```typescript
import { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

const ResultSchema = z.object({
  success: z.boolean(),
  data: z.array(z.number()),
});

const engine = new PythonEngine();
const result = await engine.runScript(
  'tools/analysis/script.py',
  { input: 'data' },
  ResultSchema
);

// result is typed as { success: boolean; data: number[] }
```

### EventBus Pattern

```typescript
import { EventBus } from '@quantbot/utils';

const bus = new EventBus();

// Subscribe
bus.on('simulation.complete', (result) => {
  console.log('Simulation complete:', result);
});

// Emit
bus.emit('simulation.complete', { runId: '123', pnl: 0.15 });
```

## Related Documentation

- [ARCHITECTURE.md](../../docs/architecture/ARCHITECTURE.md) - System architecture
- [packages/core/README.md](../core/README.md) - Core package documentation

