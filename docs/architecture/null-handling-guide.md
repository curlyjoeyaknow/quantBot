# Null Handling Guide

## Overview

This guide documents best practices for handling null and undefined values in the QuantBot codebase. TypeScript's strict null checks are enabled, so we need to handle nullability explicitly.

## Type Guards

Use type guards to narrow types safely:

```typescript
import { isNotNull, isNullish, isNonEmptyString } from '@quantbot/utils';

// ✅ GOOD: Type guard narrows type
function processCandles(candles: Candle[] | null | undefined) {
  if (isNotNull(candles)) {
    // TypeScript knows candles is Candle[] here
    return candles.map(c => c.close);
  }
  return [];
}

// ✅ GOOD: Check for non-empty strings
function validateAddress(address: string | null | undefined) {
  if (isNonEmptyString(address)) {
    // TypeScript knows address is string here
    return address.length > 0;
  }
  return false;
}
```

## Safe Accessors

Use safe accessor functions instead of manual null checks:

```typescript
import { safeGet, safeNestedGet, orDefault } from '@quantbot/utils';

// ✅ GOOD: Safe property access
const price = safeGet(candle, 'close', 0);

// ✅ GOOD: Safe nested access
const symbol = safeNestedGet(call, ['token', 'symbol'], 'UNKNOWN');

// ✅ GOOD: Default value
const count = orDefault(maybeCount, 0);
```

## Array Operations

Filter and map with null safety:

```typescript
import { filterNullish, mapAndFilterNullish, firstNotNull } from '@quantbot/utils';

// ✅ GOOD: Filter out nulls
const validPrices = filterNullish(prices); // number[] instead of (number | null | undefined)[]

// ✅ GOOD: Map and filter in one step
const closes = mapAndFilterNullish(candles, c => c?.close); // number[]

// ✅ GOOD: Get first non-null
const firstPrice = firstNotNull([candle1?.close, candle2?.close, candle3?.close]);
```

## Coalescing

Use coalescing functions for fallback values:

```typescript
import { coalesce, coalesceWithDefault } from '@quantbot/utils';

// ✅ GOOD: First non-null value
const price = coalesce(candle.close, candle.open, 0);

// ✅ GOOD: With default
const price = coalesceWithDefault(0, candle.close, candle.open);
```

## Assertions

Use assertions when you're certain a value is not null:

```typescript
import { assertNotNull, requireNotNull } from '@quantbot/utils';

// ✅ GOOD: Assert with message
function processCandle(candle: Candle | null) {
  assertNotNull(candle, 'Candle must not be null');
  // TypeScript knows candle is Candle here
  return candle.close;
}

// ✅ GOOD: Require with context
function getTokenAddress(call: Call | null) {
  return requireNotNull(call?.token?.address, { callId: call?.id });
}
```

## Common Patterns

### Pattern 1: Optional Chaining with Nullish Coalescing

```typescript
// ❌ BAD: Manual null checks
const price = candle ? (candle.close ?? 0) : 0;

// ✅ GOOD: Use utilities
import { safeGet } from '@quantbot/utils';
const price = safeGet(candle, 'close', 0);
```

### Pattern 2: Array Filtering

```typescript
// ❌ BAD: Manual filtering
const valid = candles.filter(c => c !== null && c !== undefined);

// ✅ GOOD: Use filterNullish
import { filterNullish } from '@quantbot/utils';
const valid = filterNullish(candles);
```

### Pattern 3: Nested Property Access

```typescript
// ❌ BAD: Optional chaining chain
const symbol = call?.token?.symbol ?? 'UNKNOWN';

// ✅ GOOD: Use safeNestedGet
import { safeNestedGet } from '@quantbot/utils';
const symbol = safeNestedGet(call, ['token', 'symbol'], 'UNKNOWN');
```

### Pattern 4: Multiple Fallbacks

```typescript
// ❌ BAD: Nested ternary
const price = candle?.close ?? candle?.open ?? 0;

// ✅ GOOD: Use coalesce
import { coalesceWithDefault } from '@quantbot/utils';
const price = coalesceWithDefault(0, candle?.close, candle?.open);
```

## Rules

1. **Always use type guards** when checking for null/undefined
2. **Use safe accessors** instead of manual null checks
3. **Filter nulls explicitly** when working with arrays
4. **Provide defaults** when values might be null
5. **Use assertions** only when you're certain a value exists
6. **Avoid optional chaining chains** - use safe accessors instead

## Migration Checklist

When refactoring existing code:

- [ ] Replace manual null checks with type guards
- [ ] Replace optional chaining chains with safe accessors
- [ ] Replace manual array filtering with `filterNullish`
- [ ] Replace nested ternaries with `coalesce`
- [ ] Add type guards to function parameters
- [ ] Use `orDefault` instead of `??` when appropriate

## Examples

### Before (Manual Null Checks)

```typescript
function calculateAverage(candles: Candle[] | null | undefined): number {
  if (candles === null || candles === undefined) {
    return 0;
  }
  const closes = candles
    .map(c => c?.close)
    .filter(c => c !== null && c !== undefined) as number[];
  if (closes.length === 0) {
    return 0;
  }
  return closes.reduce((a, b) => a + b, 0) / closes.length;
}
```

### After (Using Utilities)

```typescript
import { isNotNull, mapAndFilterNullish, orDefault } from '@quantbot/utils';

function calculateAverage(candles: Candle[] | null | undefined): number {
  if (!isNotNull(candles)) {
    return 0;
  }
  const closes = mapAndFilterNullish(candles, c => c.close);
  if (closes.length === 0) {
    return 0;
  }
  return closes.reduce((a, b) => a + b, 0) / closes.length;
}
```

## Benefits

1. **Type Safety**: TypeScript can narrow types correctly
2. **Readability**: Code is more expressive and easier to understand
3. **Consistency**: All null handling follows the same patterns
4. **Maintainability**: Changes to null handling logic are centralized
5. **Performance**: No runtime overhead (all functions are simple checks)




