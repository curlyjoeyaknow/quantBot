# leaderboard Handler

## Overview

Shows research simulation leaderboard.

## Location

`packages/cli/src/handlers/research/leaderboard.ts`

## Handler Function

`leaderboardHandler`

## Command

```bash
quantbot research leaderboard [options]
```

## Examples

```bash
# Show leaderboard (default: ranked by return, desc)
quantbot research leaderboard

# Custom ranking criteria
quantbot research leaderboard --criteria sharpe --order desc

# Filter by strategy
quantbot research leaderboard --strategy-name my_strategy

# Filter by snapshot
quantbot research leaderboard --snapshot-id snapshot_123

# Minimum thresholds
quantbot research leaderboard --min-return 0.5 --min-win-rate 0.6

# Limit results
quantbot research leaderboard --limit 20
```

## Parameters

- `--format <format>`: Output format
- `--criteria <criteria>`: Ranking criteria (default: `return`)
- `--order <asc|desc>`: Sort order (default: `desc`)
- `--limit <count>`: Limit number of results
- `--strategy-name <name>`: Filter by strategy name
- `--snapshot-id <id>`: Filter by snapshot ID
- `--min-return <number>`: Minimum return threshold
- `--min-win-rate <number>`: Minimum win rate threshold (0-1)

## Returns

```typescript
{
  runs: LeaderboardEntry[];
  total: number;
}
```

## Related

- [[list-runs]] - List all runs
- [[show-run]] - Show specific run

