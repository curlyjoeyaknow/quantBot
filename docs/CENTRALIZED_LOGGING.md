# Centralized Logging System

## Overview

QuantBot uses a centralized, package-aware logging system built on Winston with structured output, log rotation, context propagation, and optional forwarding to external services.

## Architecture

```
@quantbot/utils/logging
├── logger.ts          # Core Winston logger with namespace support
├── logging-config.ts  # Configuration utilities
├── logging-middleware.ts  # Request/response logging
├── logging/
│   ├── index.ts      # Public API and helpers
│   ├── aggregator.ts # Log forwarding to external services
│   └── monitor.ts    # Pattern detection and alerting
```

## Package Loggers

Each package has its own namespaced logger that automatically includes the package name in all log entries.

### Usage in Packages

```typescript
// packages/services/src/logger.ts
import { createPackageLogger } from '@quantbot/utils/logging';

export const logger = createPackageLogger('@quantbot/services');

// Usage in service files
import { logger } from './logger';

logger.info('Service started', { version: '1.0.0' });
// Output: { namespace: '@quantbot/services', message: 'Service started', version: '1.0.0', ... }
```

### Available Package Loggers

- `@quantbot/bot` - Telegram bot operations
- `@quantbot/services` - Business logic services
- `@quantbot/monitoring` - Real-time monitoring and streams
- `@quantbot/simulation` - Trading simulation engine
- `@quantbot/storage` - Storage layer operations
- `@quantbot/utils` - Utility functions
- `@quantbot/web` - Web dashboard

## Log Levels

```typescript
enum LogLevel {
  ERROR = 'error',   // Application errors
  WARN = 'warn',     // Warning conditions
  INFO = 'info',     // Informational messages
  DEBUG = 'debug',   // Debug-level messages
  TRACE = 'trace',   // Most verbose logging
}
```

### Default Levels

- **Production**: `INFO` (errors, warnings, and info)
- **Development**: `DEBUG` (all messages except trace)
- **Override**: Set `LOG_LEVEL` environment variable

## Environment Configuration

```bash
# Log level (error, warn, info, debug, trace)
LOG_LEVEL=debug

# Enable/disable console logging
LOG_CONSOLE=true

# Enable/disable file logging
LOG_FILE=true

# Log directory
LOG_DIR=./logs

# Log rotation settings
LOG_MAX_FILES=14d     # Keep logs for 14 days
LOG_MAX_SIZE=20m      # Max 20MB per file
```

## Structured Logging

### Basic Usage

```typescript
import { logger } from './logger';

// Simple message
logger.info('User logged in');

// With context
logger.info('API request completed', {
  method: 'GET',
  path: '/api/tokens',
  duration: 123,
  statusCode: 200,
});

// Error logging
try {
  await riskyOperation();
} catch (error) {
  logger.error('Operation failed', error, {
    operation: 'riskyOperation',
    userId: 123,
  });
}
```

### Child Loggers

Create child loggers with persistent context:

```typescript
const sessionLogger = logger.child({ sessionId: 'abc123', userId: 456 });

sessionLogger.info('Session started');
// Automatically includes sessionId and userId in all logs

sessionLogger.debug('Processing trade');
// All logs from this logger include the context
```

### Log Helpers

Pre-built helpers for common operations:

```typescript
import { LogHelpers } from '@quantbot/utils/logging';

// API requests
LogHelpers.apiRequest(logger, 'GET', 'https://api.example.com/data');
LogHelpers.apiResponse(logger, 'GET', 'https://api.example.com/data', 200, 123);

// Database queries
LogHelpers.dbQuery(logger, 'SELECT', 'tokens', 45, { rows: 100 });

// WebSocket events
LogHelpers.websocketEvent(logger, 'message', { type: 'trade' });

// Simulations
LogHelpers.simulation(logger, 'ichimoku-v1', 'token123', { pnl: 1.5 });

// Cache operations
LogHelpers.cache(logger, 'hit', 'ohlcv:token123:1m');

// Performance metrics
LogHelpers.performance(logger, 'fetchCandles', 234, true, { tokenCount: 5 });
```

## Log Aggregation

Forward logs to external services like CloudWatch, Datadog, or Elasticsearch.

### Configuration

```typescript
import { initializeLogAggregator } from '@quantbot/utils/logging';

const aggregator = initializeLogAggregator({
  enabled: true,
  batchSize: 100,
  flushInterval: 5000, // 5 seconds
  endpoint: 'https://logs.example.com/api/logs',
  apiKey: process.env.LOG_API_KEY,
  serviceType: 'custom', // 'cloudwatch' | 'datadog' | 'elasticsearch' | 'custom'
});

// Logs will now be automatically forwarded
```

### Supported Services

- **CloudWatch**: AWS CloudWatch Logs
- **Datadog**: Datadog Log Management
- **Elasticsearch**: Elasticsearch/OpenSearch
- **Custom**: Any HTTP endpoint accepting JSON logs

## Log Monitoring

Real-time pattern detection and alerting.

### Initialize Monitor

```typescript
import { initializeLogMonitor, CommonPatterns } from '@quantbot/utils/logging';

const monitor = initializeLogMonitor();

// Listen for alerts
monitor.on('alert', (alert) => {
  console.error('LOG ALERT:', alert);
  // Send to Slack, PagerDuty, etc.
});
```

### Custom Patterns

```typescript
monitor.registerPattern({
  id: 'high-api-errors',
  name: 'High API Error Rate',
  level: 'error',
  namespacePattern: '@quantbot/services',
  messagePattern: /API.*failed/i,
  threshold: 10,
  timeWindow: 60000, // 1 minute
  onMatch: (log) => {
    // Custom alert logic
    sendSlackAlert('High API error rate detected!');
  },
});
```

### Pre-built Patterns

```typescript
import { CommonPatterns } from '@quantbot/utils/logging';

monitor.registerPattern(CommonPatterns.databaseErrors());
monitor.registerPattern(CommonPatterns.rateLimitErrors());
monitor.registerPattern(CommonPatterns.authFailures());
monitor.registerPattern(CommonPatterns.websocketDisconnects());
monitor.registerPattern(CommonPatterns.memoryWarnings());
```

## Log Formats

### Development (Console)

```
[2025-12-05 10:30:45.123] info: Service started
{
  "namespace": "@quantbot/services",
  "version": "1.0.2",
  "service": "quantbot"
}
```

### Production (JSON)

```json
{
  "timestamp": "2025-12-05T10:30:45.123Z",
  "level": "info",
  "message": "Service started",
  "namespace": "@quantbot/services",
  "version": "1.0.2",
  "service": "quantbot"
}
```

## File Outputs

Logs are written to `logs/` directory with daily rotation:

- `logs/combined-YYYY-MM-DD.log` - All logs
- `logs/error-YYYY-MM-DD.log` - Error logs only

Files are:
- Compressed after rotation
- Kept for 14 days by default
- Limited to 20MB per file

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// ❌ Bad - Using info for debug details
logger.info('Processing item 5 of 100');

// ✅ Good - Use debug for detailed progress
logger.debug('Processing item 5 of 100');

// ❌ Bad - Using error for warnings
logger.error('Cache miss for key: token123');

// ✅ Good - Use appropriate level
logger.debug('Cache miss for key: token123');
```

### 2. Include Context

```typescript
// ❌ Bad - Minimal context
logger.error('Failed');

// ✅ Good - Rich context
logger.error('Failed to fetch OHLCV data', error, {
  tokenAddress: 'abc123',
  timeframe: '1m',
  retries: 3,
  duration: 5000,
});
```

### 3. Use Package Loggers

```typescript
// ❌ Bad - Using root logger everywhere
import { logger } from '@quantbot/utils';

// ✅ Good - Use package-specific logger
import { logger } from './logger'; // Package logger with namespace
```

### 4. Don't Log Sensitive Data

```typescript
// ❌ Bad - Logging secrets
logger.info('API request', { apiKey: process.env.API_KEY });

// ✅ Good - Redact sensitive fields
logger.info('API request', { 
  apiKey: '***REDACTED***',
  endpoint: '/api/data'
});
```

### 5. Use Helpers for Common Patterns

```typescript
// ❌ Bad - Manual formatting
logger.info('API Response', {
  method: 'GET',
  url: 'https://api.example.com',
  statusCode: 200,
  duration: 123,
});

// ✅ Good - Use helper
LogHelpers.apiResponse(logger, 'GET', 'https://api.example.com', 200, 123);
```

## Performance Considerations

- Logs are asynchronous by default (non-blocking)
- File I/O uses streams and buffering
- Log aggregation uses batching to reduce network calls
- In production, use `INFO` level to reduce overhead
- Disable file logging in tests (`NODE_ENV=test`)

## Testing

Logs are automatically disabled for file output in test environment:

```typescript
// In tests
process.env.NODE_ENV = 'test';

// Logger will only output to console, not files
// This prevents test pollution and file system issues
```

## Migration Guide

### From Direct Winston Import

```typescript
// Before
import { logger } from '@quantbot/utils';

// After
import { logger } from './logger'; // Package-specific logger
```

### Adding Package Logger

1. Create `packages/{name}/src/logger.ts`:

```typescript
import { createPackageLogger } from '@quantbot/utils/logging';

export const logger = createPackageLogger('@quantbot/{name}');
```

2. Export from package index:

```typescript
// packages/{name}/src/index.ts
export { logger } from './logger';
```

3. Use in package files:

```typescript
import { logger } from './logger';
```

## Troubleshooting

### Logs Not Appearing

1. Check log level: `LOG_LEVEL=debug`
2. Verify console output enabled: `LOG_CONSOLE=true`
3. Check if in test environment (file logging disabled)

### File Permission Errors

1. Ensure log directory exists and is writable
2. Check `LOG_DIR` environment variable
3. Verify process has write permissions

### High Memory Usage

1. Reduce log level in production to `INFO`
2. Decrease `LOG_MAX_FILES` to keep fewer days
3. Reduce `LOG_MAX_SIZE` for smaller files
4. Enable log aggregation with smaller batch size

## Future Enhancements

- [ ] Integration with external monitoring services (Sentry, New Relic)
- [ ] Real-time log streaming dashboard
- [ ] Advanced filtering and search
- [ ] Log analytics and insights
- [ ] Performance profiling integration

