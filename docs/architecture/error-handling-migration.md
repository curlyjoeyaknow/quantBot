# Error Handling Migration Guide

## Overview

This guide documents the migration from plain `Error` to standardized error classes (`AppError`, `ValidationError`, etc.) from `@quantbot/utils`.

## Error Classes Available

### Base Classes

- **`AppError`** - Base application error class
  - Properties: `code`, `statusCode`, `context`, `isOperational`
  - Use for: General application errors

- **`ValidationError`** - Input validation failures
  - Extends: `AppError`
  - Code: `VALIDATION_ERROR`
  - Status: `400`
  - Use for: Invalid input, schema validation failures

- **`NotFoundError`** - Missing resources
  - Extends: `AppError`
  - Code: `NOT_FOUND`
  - Status: `404`
  - Use for: Resource not found

- **`DatabaseError`** - Database operation failures
  - Extends: `AppError`
  - Code: `DATABASE_ERROR`
  - Status: `500`
  - Use for: Database connection, query failures

- **`ApiError`** - External API failures
  - Extends: `AppError`
  - Code: `API_ERROR`
  - Status: `500` (or API status code)
  - Use for: External API call failures

- **`TimeoutError`** - Operation timeouts
  - Extends: `AppError`
  - Code: `TIMEOUT_ERROR`
  - Status: `504`
  - Use for: Operation timeouts

## Migration Pattern

### Before (Plain Error)

```typescript
if (!value) {
  throw new Error('Value is required');
}

if (!isValid) {
  throw new Error(`Invalid input: ${input}`);
}
```

### After (Standardized Errors)

```typescript
import { ValidationError, NotFoundError, AppError } from '@quantbot/utils';

// Validation errors
if (!value) {
  throw new ValidationError('Value is required', { field: 'value' });
}

if (!isValid) {
  throw new ValidationError(`Invalid input: ${input}`, { input });
}

// Not found errors
if (!resource) {
  throw new NotFoundError('User', userId, { userId });
}

// General application errors
if (operationFailed) {
  throw new AppError('Operation failed', 'OPERATION_FAILED', 500, { operationId });
}
```

## Migration Checklist

### Step 1: Identify Error Types

For each `throw new Error()`, determine the appropriate error class:
- **ValidationError**: Input validation, schema validation
- **NotFoundError**: Resource not found
- **DatabaseError**: Database operations
- **ApiError**: External API calls
- **TimeoutError**: Timeouts
- **AppError**: General application errors

### Step 2: Update Imports

```typescript
import { ValidationError, NotFoundError, AppError } from '@quantbot/utils';
```

### Step 3: Replace Error Throws

Replace `throw new Error(...)` with appropriate error class:
- Add context when available
- Use appropriate error codes
- Set status codes for HTTP contexts

### Step 4: Update Error Handling

Update error handling code to check for error types:

```typescript
try {
  // ...
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation error
  } else if (error instanceof NotFoundError) {
    // Handle not found
  } else if (error instanceof AppError) {
    // Handle application error
  } else {
    // Handle unknown error
  }
}
```

### Step 5: Update Tests

Update tests to expect new error types:

```typescript
// Before
expect(() => validate(input)).toThrow('Invalid input');

// After
expect(() => validate(input)).toThrow(ValidationError);
expect(() => validate(input)).toThrow('Invalid input');
```

## Package-Specific Guidelines

### Workflows Package

- Use `ValidationError` for spec validation
- Use `NotFoundError` for missing resources
- Use `AppError` for workflow failures

### CLI Package

- Use `ValidationError` for argument validation
- Use `AppError` for command execution failures
- Errors are automatically converted to contracts via `errorToContract()`

### Storage Package

- Use `DatabaseError` for database operations
- Use `NotFoundError` for missing records
- Use `ValidationError` for invalid queries

### Ingestion Package

- Use `ValidationError` for invalid input data
- Use `AppError` for ingestion failures

## Benefits

1. **Structured Errors**: Errors have codes, status codes, and context
2. **Better Logging**: Errors can be serialized to JSON
3. **Error Contracts**: Errors are converted to standardized contracts
4. **Type Safety**: TypeScript can narrow error types
5. **Retry Logic**: `isRetryableError()` can determine if error is retryable

## Examples

### Example 1: Validation Error

```typescript
// Before
if (!tokenId) {
  throw new Error('Token ID is required');
}

// After
import { ValidationError } from '@quantbot/utils';

if (!tokenId) {
  throw new ValidationError('Token ID is required', { field: 'tokenId' });
}
```

### Example 2: Not Found Error

```typescript
// Before
if (!strategy) {
  throw new Error(`Strategy ${strategyId} not found`);
}

// After
import { NotFoundError } from '@quantbot/utils';

if (!strategy) {
  throw new NotFoundError('Strategy', strategyId, { strategyId });
}
```

### Example 3: Database Error

```typescript
// Before
try {
  await db.query(sql);
} catch (error) {
  throw new Error(`Database query failed: ${error.message}`);
}

// After
import { DatabaseError } from '@quantbot/utils';

try {
  await db.query(sql);
} catch (error) {
  throw new DatabaseError('Database query failed', { sql, originalError: error.message });
}
```

## Testing

When migrating, ensure tests are updated:

```typescript
// Test error type
expect(() => function()).toThrow(ValidationError);

// Test error message
expect(() => function()).toThrow('Expected error message');

// Test error context
try {
  function();
} catch (error) {
  expect(error).toBeInstanceOf(ValidationError);
  expect(error.context).toEqual({ field: 'value' });
}
```

## Migration Order

1. **High-impact packages first**: Workflows, CLI (user-facing)
2. **Storage layer**: Database operations
3. **Ingestion layer**: Data processing
4. **Utility packages**: Helper functions

## Notes

- Some `throw new Error()` in tests are acceptable (testing error handling)
- Error handling in composition roots may use plain Error for wrapping
- Migration should be done incrementally, package by package

