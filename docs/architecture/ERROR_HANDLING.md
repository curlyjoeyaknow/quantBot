# Error Handling Standards

## Overview

QuantBot uses a standardized error handling system based on `AppError` and its subclasses. This ensures consistent error handling, better testability, and improved debugging.

## Error Class Hierarchy

All errors should extend `AppError` from `@quantbot/utils`:

```typescript
import {
  AppError,
  ValidationError,
  NotFoundError,
  DatabaseError,
  ApiError,
  RateLimitError,
  TimeoutError,
  ConfigurationError,
  ServiceUnavailableError,
} from '@quantbot/utils';
```

### Available Error Classes

| Error Class | Status Code | Use Case |
|------------|------------|----------|
| `ValidationError` | 400 | Input validation failures |
| `NotFoundError` | 404 | Missing resources |
| `AuthenticationError` | 401 | Authentication failures |
| `AuthorizationError` | 403 | Permission failures |
| `DatabaseError` | 500 | Database operation failures |
| `ApiError` | 502 | External API call failures |
| `RateLimitError` | 429 | Rate limiting |
| `TimeoutError` | 504 | Operation timeouts |
| `ConfigurationError` | 500 | Configuration issues |
| `ServiceUnavailableError` | 503 | Service unavailability |
| `AppError` | 500 | Generic application errors |

## Rules

### 1. Always Use Custom Error Classes

❌ **Don't:**
```typescript
throw new Error('User not found');
throw new Error('Invalid input');
```

✅ **Do:**
```typescript
throw new NotFoundError('User', userId);
throw new ValidationError('Invalid token address format', { address });
```

### 2. Provide Context

Always include relevant context in errors:

```typescript
throw new DatabaseError(
  'Failed to insert candles',
  'insertCandles',
  { mint, chain, count: candles.length }
);
```

### 3. Use Appropriate Error Types

- **ValidationError**: Input validation, schema validation, format errors
- **NotFoundError**: Missing resources (users, tokens, records)
- **DatabaseError**: Database connection, query, transaction failures
- **ApiError**: External API failures (Birdeye, Helius, etc.)
- **RateLimitError**: Rate limit exceeded (include `retryAfter`)
- **TimeoutError**: Operation timeouts (include `timeoutMs`)
- **ConfigurationError**: Missing or invalid configuration
- **ServiceUnavailableError**: Service is down or unavailable

### 4. Error Handling

Use `handleError` from `@quantbot/utils` for consistent error handling:

```typescript
import { handleError } from '@quantbot/utils';

try {
  await someOperation();
} catch (error) {
  const result = handleError(error, { operation: 'someOperation' });
  if (result.shouldRetry) {
    // Retry logic
  }
  throw error; // Re-throw if needed
}
```

### 5. Async Error Handling

Use `withErrorHandling` wrapper for async functions:

```typescript
import { withErrorHandling } from '@quantbot/utils';

const safeOperation = withErrorHandling(
  async (input: string) => {
    // Operation that may throw
  },
  { operation: 'safeOperation' }
);
```

### 6. Testing

In tests, check for specific error types:

```typescript
import { NotFoundError, ValidationError } from '@quantbot/utils';

it('should throw NotFoundError when resource not found', async () => {
  await expect(service.getById('missing-id')).rejects.toThrow(NotFoundError);
});

it('should throw ValidationError for invalid input', async () => {
  await expect(service.validate('invalid')).rejects.toThrow(ValidationError);
});
```

## Migration Checklist

When refactoring existing code:

- [ ] Replace `throw new Error()` with appropriate `AppError` subclass
- [ ] Add context to error constructors
- [ ] Update error handling to use `handleError()`
- [ ] Update tests to check for specific error types
- [ ] Remove generic error messages, use descriptive ones

## Examples

### Before (Inconsistent)
```typescript
if (!token) {
  throw new Error('Token not found');
}

if (!isValidAddress(address)) {
  throw new Error('Invalid address');
}

try {
  await db.query('SELECT ...');
} catch (error) {
  throw new Error('Database error');
}
```

### After (Standardized)
```typescript
if (!token) {
  throw new NotFoundError('Token', address);
}

if (!isValidAddress(address)) {
  throw new ValidationError('Invalid token address format', { address });
}

try {
  await db.query('SELECT ...');
} catch (error) {
  throw new DatabaseError('Failed to query database', 'query', { error: error.message });
}
```

## Benefits

1. **Testability**: Easy to test for specific error types
2. **Consistency**: All errors follow the same pattern
3. **Context**: Errors include relevant context for debugging
4. **Type Safety**: TypeScript can narrow error types
5. **Logging**: Structured error data for better logging
6. **Retry Logic**: Built-in retry detection via `isRetryableError()`

