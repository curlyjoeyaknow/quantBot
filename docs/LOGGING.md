# Structured Logging System

## Overview

The QuantBot application uses a centralized, structured logging system built on Winston. This provides:

- **Structured JSON logs** for production (machine-readable)
- **Human-readable console logs** for development
- **Log rotation** with automatic cleanup
- **Context propagation** for request tracking
- **Error tracking** with stack traces
- **Performance monitoring** with duration tracking

## Architecture

### Core Components

1. **`src/utils/logger.ts`** - Main logger implementation
2. **`src/utils/logging-config.ts`** - Logging configuration utilities
3. **`src/utils/logging-middleware.ts`** - Request/response logging middleware
4. **`web/lib/logger.ts`** - Next.js logger adapter

### Logger Features

- **Log Levels**: `error`, `warn`, `info`, `debug`, `trace`
- **Context Support**: Attach metadata to all logs
- **Child Loggers**: Create loggers with persistent context
- **File Rotation**: Daily rotation with compression
- **Error Handling**: Automatic stack trace capture

## Usage

### Basic Logging

```typescript
import { logger } from '../utils/logger';

// Simple logging
logger.info('User logged in');
logger.error('Database connection failed', error);
logger.debug('Processing request', { userId: 123 });

// With context
logger.warn('Rate limit approaching', {
  userId: 123,
  tokenAddress: '0x...',
  requests: 95,
  limit: 100,
});
```

### Context Propagation

```typescript
import { logger } from '../utils/logger';

// Set persistent context
logger.setContext({ userId: 123, sessionId: 'abc' });

// All subsequent logs will include this context
logger.info('Processing order'); // Includes userId and sessionId

// Clear context
logger.clearContext();
```

### Child Loggers

```typescript
import { logger } from '../utils/logger';

// Create a child logger with persistent context
const requestLogger = logger.child({
  requestId: 'req-123',
  userId: 456,
});

// All logs from this logger include the context
requestLogger.info('Processing request');
requestLogger.error('Request failed', error);
```

### Next.js API Routes

```typescript
import { logger } from '@/lib/logger';
import { createRequestLogger } from '@/lib/logger';

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const requestLogger = createRequestLogger(requestId, {
    method: 'GET',
    path: '/api/endpoint',
  });

  try {
    requestLogger.info('Processing request');
    // ... your logic
    requestLogger.info('Request completed', { statusCode: 200 });
  } catch (error) {
    requestLogger.error('Request failed', error as Error);
    throw error;
  }
}
```

### Performance Logging

```typescript
import { logPerformance } from '../utils/logging-middleware';

// Automatically log performance metrics
const fetchData = logPerformance(
  async (userId: number) => {
    // Your async operation
    return await database.getUser(userId);
  },
  'fetchUser',
  { userId: 123 }
);

// Usage - automatically logs start, completion, and duration
const user = await fetchData(123);
```

### Error Logging

```typescript
import { logger } from '../utils/logger';

try {
  // Your code
} catch (error) {
  // Automatically captures stack trace and error details
  logger.error('Operation failed', error, {
    userId: 123,
    operation: 'processPayment',
  });
}
```

## Configuration

### Environment Variables

```bash
# Log level (error, warn, info, debug, trace)
LOG_LEVEL=info

# Enable/disable console output
LOG_CONSOLE=true

# Enable/disable file logging
LOG_FILE=true

# Log directory
LOG_DIR=./logs

# Max file size before rotation
LOG_MAX_SIZE=20m

# Max number of days to keep logs
LOG_MAX_FILES=14d
```

### Log Files

Logs are written to the `logs/` directory:

- `error-YYYY-MM-DD.log` - Error-level logs only
- `combined-YYYY-MM-DD.log` - All log levels
- Old logs are automatically compressed and archived

## Best Practices

### 1. Use Appropriate Log Levels

- **ERROR**: System errors, exceptions, failures
- **WARN**: Recoverable issues, deprecations, rate limits
- **INFO**: Important events, state changes, user actions
- **DEBUG**: Detailed information for debugging
- **TRACE**: Very verbose, detailed execution flow

### 2. Include Context

Always include relevant context:

```typescript
// Good
logger.info('Order processed', {
  orderId: order.id,
  userId: order.userId,
  amount: order.amount,
  status: order.status,
});

// Bad
logger.info('Order processed');
```

### 3. Don't Log Sensitive Data

Never log:
- Passwords
- API keys
- Private keys
- Personal information (PII)
- Credit card numbers

### 4. Use Structured Data

Always use objects for context, not string interpolation:

```typescript
// Good
logger.info('User action', { userId, action, timestamp });

// Bad
logger.info(`User ${userId} performed ${action} at ${timestamp}`);
```

### 5. Error Logging

Always include the error object:

```typescript
// Good
logger.error('Database query failed', error, { query, params });

// Bad
logger.error(`Database query failed: ${error.message}`);
```

## Migration Guide

### Replacing console.log

```typescript
// Before
console.log('User logged in');
console.error('Error:', error);

// After
import { logger } from '../utils/logger';
logger.info('User logged in');
logger.error('Error occurred', error);
```

### Replacing console.log with context

```typescript
// Before
console.log(`User ${userId} processed order ${orderId}`);

// After
logger.info('Order processed', { userId, orderId });
```

## Monitoring and Analysis

### Log Aggregation

For production, consider integrating with:
- **ELK Stack** (Elasticsearch, Logstash, Kibana)
- **Datadog**
- **Sentry** (for error tracking)
- **CloudWatch** (AWS)
- **Stackdriver** (GCP)

### Querying Logs

Structured JSON logs can be easily queried:

```bash
# Find all errors for a specific user
grep '"userId":123' logs/error-*.log | jq 'select(.level=="error")'

# Find slow requests (>1s)
grep '"duration"' logs/combined-*.log | jq 'select(.duration > 1000)'

# Count errors by type
grep '"level":"error"' logs/error-*.log | jq -r '.error.name' | sort | uniq -c
```

## Troubleshooting

### Logs not appearing

1. Check `LOG_LEVEL` - logs below the configured level are filtered
2. Check `LOG_CONSOLE` and `LOG_FILE` settings
3. Verify `logs/` directory exists and is writable
4. Check file permissions

### Logs too verbose

Set `LOG_LEVEL=info` or `LOG_LEVEL=warn` in production.

### Logs missing context

Ensure you're using the logger instance with context set, or include context in each log call.

## Examples

See the following files for examples:
- `src/bot/bot.ts` - Bot command logging
- `src/services/TextWorkflowHandler.ts` - Service logging
- `src/monitoring/tenkan-kijun-alert-service.ts` - Monitoring service logging
- `web/app/api/caller-history/route.ts` - Next.js API route logging

