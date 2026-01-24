# Data Canonical Query

**Command**: `quantbot data canonical query`

**Package**: `data.canonical`

**Handler**: `packages/cli/src/handlers/data/query-canonical.ts`

## Description

Query canonical events (unified market data) with filters for asset, chain, venue, event type, and date range.

## Pattern

- **Handler**: Pure function pattern
- **Service**: Accesses `CanonicalRepository` via `CommandContext`
- **Repository**: `CanonicalDuckDBAdapter` implements `CanonicalRepository` port

## Options

- `--asset-address <address>` - Filter by asset address
- `--chain <chain>` - Filter by chain (solana, ethereum, bsc, base, evm)
- `--venue-name <name>` - Filter by venue name
- `--venue-type <type>` - Filter by venue type (dex, cex, data_provider, social, on_chain)
- `--event-type <type>` - Filter by event type (price, trade, alert, candle, volume, liquidity, metadata)
- `--from <date>` - Filter by timestamp (from, ISO 8601)
- `--to <date>` - Filter by timestamp (to, ISO 8601)
- `--source-hash <hash>` - Filter by source hash
- `--source-run-id <id>` - Filter by source run ID
- `--limit <number>` - Limit number of results
- `--offset <number>` - Offset for pagination
- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# Query by asset address
quantbot data canonical query --asset-address ABC123...

# Query by chain and event type
quantbot data canonical query --chain solana --event-type alert

# Query by date range
quantbot data canonical query --from 2024-01-01 --to 2024-12-31
```

## Related

- [[canonical-get-by-asset]] - Get canonical events by asset
- [[raw-query]] - Query raw data

