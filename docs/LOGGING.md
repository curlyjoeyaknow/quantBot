# Logging Standards

## Overview

All packages in the Golden Path use the centralized logger from `@quantbot/utils`.

## Usage

```typescript
import { logger } from '@quantbot/utils';

// Basic logging
logger.info('Service started');
logger.debug('Processing token', { tokenAddress: '7pXs...' });
logger.warn('Rate limit approaching', { remaining: 10 });
logger.error('Failed to fetch candles', error, { tokenAddress: '7pXs...' });
```

## Log Levels

- **error**: Critical errors that require attention
- **warn**: Warnings about potential issues
- **info**: General informational messages (default in production)
- **debug**: Detailed debugging information (enabled in development)

## Structured Logging

The logger supports structured metadata:

```typescript
logger.info('Ingestion complete', {
  alertsInserted: 10,
  callsInserted: 15,
  tokensUpserted: 5,
  skippedMessages: 2,
});
```

## Context Fields

Common context fields used across services:

- `tokenAddress`: Solana token address (truncated for display)
- `callerName`: Telegram caller name
- `strategyName`: Strategy identifier
- `callId`: Call ID from database
- `simulationRunId`: Simulation run ID

## Package-Specific Loggers

For package-specific namespacing:

```typescript
import { createPackageLogger } from '@quantbot/utils/logging';

const logger = createPackageLogger('@quantbot/services');
logger.info('Service started');
```

## Configuration

Logging is configured via environment variables:

- `LOG_LEVEL`: Log level (default: `info` in production, `debug` in development)
- `LOG_CONSOLE`: Enable console output (default: `true`)
- `LOG_FILE`: Enable file logging (default: `true`)
- `LOG_DIR`: Log directory (default: `./logs`)
- `LOG_MAX_FILES`: Max log files to keep (default: `14d`)
- `LOG_MAX_SIZE`: Max log file size (default: `20m`)

## Best Practices

1. **Use appropriate log levels**: Don't log everything as `info`
2. **Include context**: Always include relevant metadata
3. **Truncate addresses**: For display, truncate long addresses (but pass full addresses to functions)
4. **Error handling**: Always pass Error objects to `logger.error()`
5. **Structured data**: Use objects for metadata, not string concatenation

## Examples

### Good

```typescript
logger.info('Processing call', {
  callId: call.id,
  tokenAddress: call.tokenAddress.substring(0, 20) + '...',
  callerName: call.callerHandle,
});
```

### Bad

```typescript
console.log(`Processing call ${call.id} for token ${call.tokenAddress}`);
```
