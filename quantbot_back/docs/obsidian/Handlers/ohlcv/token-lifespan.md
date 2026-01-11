# token-lifespan Handler

## Overview

Analyzes token lifespan and activity periods.

## Location

`packages/cli/src/handlers/ohlcv/token-lifespan.ts`

## Handler Function

`tokenLifespanHandler`

## Command

```bash
quantbot ohlcv token-lifespan --mint <address> [options]
```

## Examples

```bash
# Analyze token lifespan
quantbot ohlcv token-lifespan --mint So11111111111111111111111111111111111111112

# JSON output
quantbot ohlcv token-lifespan --mint So11111111111111111111111111111111111111112 --format json
```

## Parameters

- `--mint <address>`: Mint address (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  mint: string;
  lifespan: {
    created: string;
    firstActivity: string;
    lastActivity: string;
    duration: number;
  };
}
```

## Related

- [[fetch-ohlcv]] - Fetch OHLCV data
- [[OHLCV Fetch]] - Main OHLCV fetch workflow

